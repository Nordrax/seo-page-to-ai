// Connects to the local MCP bridge (bridge/server.mjs) and runs its requests in the user's own browser.
// Guardrails: only allowed SEO hosts, visible tabs, at most one navigation per MIN_NAV_GAP_MS, never touches passwords.
importScripts('extract.js', 'format.js');

const BRIDGE = 'ws://127.0.0.1:17345';
const MIN_NAV_GAP_MS = 6000;
const ALLOWED = [/(^|\.)semrush\.com$/, /^app\.ahrefs\.com$/, /^search\.google\.com$/, /^analytics\.google\.com$/,
  /^pro\.similarweb\.com$/, /(^|\.)moz\.com$/, /^www\.bing\.com$/];
let ws = null;
let lastNav = 0;
let status = 'disconnected';
const extPending = new Map(); // id -> {resolve, reject}: requests the extension sends to the bridge (save)

const allowedUrl = (u) => { try { const h = new URL(u).hostname; return ALLOWED.some((re) => re.test(h)); } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setStatus(s) {
  status = s;
  await chrome.storage.local.set({ bridgeStatus: s, bridgeStatusAt: Date.now() });
  chrome.action.setBadgeText({ text: s === 'connected' ? 'AI' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#1f7a4d' });
}

let lastHeard = 0; // last message from the bridge (it pings every 20 s)

async function connect() {
  // An open socket that has heard nothing for 60 s is dead (bridge app froze or the PC slept): drop it and reconnect.
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastHeard > 60000) { try { ws.close(); } catch {} ws = null; }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const { bridgeToken } = await chrome.storage.local.get('bridgeToken');
  if (!bridgeToken) { await setStatus('no-token'); return; }
  // Probe quietly first: a WebSocket to a closed port makes Chrome log "connection refused" on the extension's errors
  // page every 30 s while no Claude Code session runs the bridge. A failed no-cors fetch is caught silently.
  const up = await fetch('http://127.0.0.1:17345/', { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(1500) })
    .then(() => true, () => false);
  // If Chrome blocks the probe itself (local-network rules), fall back to trying the WebSocket every 4th round.
  connect.misses = up ? 0 : (connect.misses || 0) + 1;
  if (!up && connect.misses % 4 !== 0) { await setStatus('disconnected'); return; }
  try {
    ws = new WebSocket(`${BRIDGE}/?token=${encodeURIComponent(bridgeToken)}`);
  } catch { await setStatus('disconnected'); return; }
  ws.onopen = () => { lastHeard = Date.now(); setStatus('connected'); };
  ws.onclose = () => { setStatus('disconnected'); ws = null; };
  ws.onerror = () => {};
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    lastHeard = Date.now();
    if (msg.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
    if (msg.type === 'saved' && extPending.has(msg.id)) { const r = extPending.get(msg.id); extPending.delete(msg.id); return msg.ok ? r.resolve(msg.result) : r.reject(new Error(msg.error)); }
    if (typeof msg.id !== 'string' || typeof msg.tool !== 'string' || msg.id.length > 64) return;
    try {
      const result = await handle(msg.tool, msg.args || {});
      ws.send(JSON.stringify({ id: msg.id, ok: true, result }));
    } catch (e) {
      ws.send(JSON.stringify({ id: msg.id, ok: false, error: String(e && e.message || e) }));
    }
  };
}

async function readTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!allowedUrl(tab.url)) throw new Error(`Not an allowed SEO site: ${tab.url ? new URL(tab.url).hostname : 'unknown'}. Allowed: Semrush, Ahrefs, Search Console, GA, Similarweb, Moz, Bing Webmaster.`);
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractSeoPage, args: [{}] });
  await chrome.storage.local.set({ lastCapture: result });
  return { markdown: toMarkdown(result), url: result.url, tables: result.tables.length, rows: result.tables.reduce((n, t) => n + t.rows.length, 0) };
}

async function waitForSettled(tabId, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') break;
    await sleep(500);
  }
  // SEO apps render their tables after load: wait until a grid/table shows up or the text stops changing.
  let last = '';
  for (let i = 0; i < 20; i++) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => [document.querySelectorAll('[role="row"], tr').length, (document.body.innerText || '').length].join(':'),
    });
    if (result === last && !result.startsWith('0:')) return;
    last = result;
    await sleep(1500);
  }
}

async function handle(tool, args) {
  if (tool === 'list_tabs') {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((t) => allowedUrl(t.url)).map((t) => ({ tabId: t.id, title: t.title, url: t.url, active: t.active }));
  }
  if (tool === 'read_current_page') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) throw new Error('No active tab');
    return readTab(tab.id);
  }
  if (tool === 'read_tab') return readTab(Number(args.tabId));
  if (tool === 'open_and_read') {
    const url = String(args.url || '');
    if (!allowedUrl(url) || !url.startsWith('https://')) throw new Error(`Refusing to open a non-SEO site: ${url}`);
    const wait = lastNav + MIN_NAV_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait); // human pace
    lastNav = Date.now();
    // Reuse one "AI" tab. Visible mode (default): a tab the user sees. Background mode (user's choice in the popup):
    // the tab lives in its own minimized window, so the user's own tabs never change.
    const { aiTabId, aiWindowId, browseMode } = await chrome.storage.local.get(['aiTabId', 'aiWindowId', 'browseMode']);
    const background = browseMode === 'background';
    let tab = null;
    if (aiTabId) tab = await chrome.tabs.get(aiTabId).catch(() => null);
    if (tab && background && tab.windowId !== aiWindowId) tab = null; // AI tab sits in a normal window: start a hidden one
    if (tab) tab = await chrome.tabs.update(tab.id, { url, active: !background });
    else if (background) {
      const win = await chrome.windows.create({ url, focused: false });
      tab = win.tabs[0];
      await chrome.storage.local.set({ aiWindowId: win.id });
    } else tab = await chrome.tabs.create({ url, active: true });
    // Chrome ignores state:'minimized' on create, so minimize afterwards (and again if the user restored it).
    if (background) await chrome.windows.update(tab.windowId, { state: 'minimized' }).catch(() => {});
    await chrome.storage.local.set({ aiTabId: tab.id });
    await sleep(1500);
    await waitForSettled(tab.id);
    return readTab(tab.id);
  }
  throw new Error(`Unknown tool ${tool}`);
}


// ---- Send to AI (v0.2): capture the report, open Claude or ChatGPT in a new tab, paste it in and send. ----
const AI_TARGETS = {
  claude: { url: 'https://claude.ai/new', name: 'Claude' },
  chatgpt: { url: 'https://chatgpt.com/', name: 'ChatGPT' },
};
const DEFAULT_QUESTION = 'Analyse this SEO report: the key findings, problems and opportunities, and 5 concrete actions in priority order.';
const MAX_CHARS = 90000; // long pastes become an attachment in Claude; keep well under chat limits

// Runs inside the claude.ai / chatgpt.com tab. Self-contained (no outer variables).
async function injectPrompt(text, autoSend) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const find = (sels) => { for (const s of sels) { const el = document.querySelector(s); if (el) return el; } return null; };
  const RICH = ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', '[data-testid="chat-input"]'];
  const PLAIN = ['div[contenteditable="true"]', 'textarea:not([data-testid="static-composer-input"])']; // skip claude.ai's loading placeholder
  const SEND = ['[data-testid="send-button"]', '#composer-submit-button', 'button[type="submit"][aria-label="Send"]', 'button[aria-label="Send message"]', 'button[aria-label="Send prompt"]', 'button[aria-label*="Send"]'];
  const getEd = (i) => find(RICH) || (i >= 20 ? find(PLAIN) : null);
  const content = (ed) => (ed.tagName === 'TEXTAREA' ? ed.value : ed.innerText || '').trim();
  const hasAttachment = () => !!document.querySelector('[data-testid*="file"], [data-testid*="attachment"]');
  const paste = async (ed) => {
    ed.focus();
    if (ed.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ed, text);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(800);
    if (!content(ed) && !hasAttachment()) document.execCommand('insertText', false, text);
  };
  // Chat apps often swap their composer right after load: wait until the same editor element has stayed put for ~1.5 s,
  // paste, then confirm the text (or an attachment) is still there; retry up to 3 times.
  let ed = null;
  let stable = 0;
  for (let i = 0; i < 80 && stable < 3; i++) {
    const cur = getEd(i);
    stable = cur && cur === ed && cur.isConnected ? stable + 1 : 0;
    ed = cur;
    await sleep(500);
  }
  if (!ed) return { ok: false, step: 'editor', note: 'Chat box not found - are you logged in?' };
  let landed = false;
  for (let attempt = 0; attempt < 3 && !landed; attempt++) {
    if (!ed || !ed.isConnected) ed = getEd(99);
    if (!ed) { await sleep(1000); continue; }
    if (!content(ed)) await paste(ed);
    await sleep(1500);
    const now = getEd(99);
    landed = !!now && (content(now).length > 0 || hasAttachment());
    ed = now;
  }
  if (!landed) return { ok: false, step: 'paste', note: 'Could not put the report into the chat box.' };
  if (!autoSend) return { ok: true, sent: false };
  for (let i = 0; i < 40; i++) { // wait for the send button (a large paste may upload as an attachment first)
    await sleep(500);
    const b = find(SEND);
    if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') { b.click(); return { ok: true, sent: true }; }
  }
  return { ok: true, sent: false, note: 'Pasted - press Enter to send.' };
}

async function sendToAi({ tabId, target = 'claude', question = '', autoSend = true }) {
  const tab = await chrome.tabs.get(tabId);
  if (!allowedUrl(tab.url)) throw new Error('Open a report on Semrush, Ahrefs, Search Console, GA, Similarweb, Moz or Bing Webmaster first.');
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractSeoPage, args: [{}] });
  await chrome.storage.local.set({ lastCapture: result });
  let md = toMarkdown(result);
  if (md.length > MAX_CHARS) md = md.slice(0, MAX_CHARS) + '\n\n(cut: report longer than ' + MAX_CHARS + ' characters)';
  const text = `${(question || DEFAULT_QUESTION).trim()}\n\n---\nSEO report captured from ${result.url}\n\n${md}`;
  const t = AI_TARGETS[target] || AI_TARGETS.claude;
  const aiTab = await chrome.tabs.create({ url: t.url, active: true, index: tab.index + 1 });
  for (let i = 0; i < 60; i++) { const x = await chrome.tabs.get(aiTab.id); if (x.status === 'complete') break; await sleep(500); }
  await sleep(1200);
  const [{ result: r }] = await chrome.scripting.executeScript({ target: { tabId: aiTab.id }, func: injectPrompt, args: [text, autoSend] });
  const rows = result.tables.reduce((n, x) => n + x.rows.length, 0);
  return { ...r, target: t.name, tables: result.tables.length, rows, metrics: result.metrics.length };
}

// ---- Save for Claude Code (v0.3): write the capture as files Claude Code (VS Code) reads later. No bridge needed. ----
// Files land in the Chrome download folder under seo-captures/ (here C:\Users\<you>\Downloads\seo-captures\):
//   <date>_<time>_<page>.md   (question + key numbers + tables, ready for an AI)
//   <date>_<time>_<page>.json (the raw capture: url, metrics, tables)
const CAPTURE_DIR = 'seo-captures';
const slug = (s) => String(s || 'seo-report').toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'seo-report';
const dataUrl = (text, type) => `data:${type};charset=utf-8,` + encodeURIComponent(text);

async function saveCapture({ tabId, question = '' }) {
  const tab = await chrome.tabs.get(tabId);
  if (!allowedUrl(tab.url)) throw new Error('Open a report on Semrush, Ahrefs, Search Console, GA, Similarweb, Moz or Bing Webmaster first.');
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractSeoPage, args: [{}] });
  await chrome.storage.local.set({ lastCapture: result });
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const base = `${CAPTURE_DIR}/${stamp}_${slug(result.heading || tab.title)}`;
  const md = (question.trim() ? `Question: ${question.trim()}\n\n` : '') + toMarkdown(result);
  const json = JSON.stringify({ question: question.trim() || null, ...result }, null, 2);
  // 1) Bridge running (a Claude app is open): the bridge writes the files itself - no browser download involved.
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      const id = Math.random().toString(36).slice(2);
      const saved = await new Promise((resolve, reject) => {
        extPending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ type: 'save', id, name: base.split('/').pop(), md, json }));
        setTimeout(() => { if (extPending.delete(id)) reject(new Error('bridge did not answer')); }, 10000);
      });
      const rows = result.tables.reduce((n, x) => n + x.rows.length, 0);
      return { ok: true, saved: true, file: saved.file, target: 'Claude Code', tables: result.tables.length, rows, metrics: result.metrics.length };
    } catch { /* fall back to a download below */ }
  }
  // 2) Fallback: a normal browser download into Downloads/seo-captures (kept in the download list).
  for (const [file, body, type] of [[`${base}.md`, md, 'text/markdown'], [`${base}.json`, json, 'application/json']]) {
    const id = await chrome.downloads.download({ url: dataUrl(body, type), filename: file, conflictAction: 'uniquify', saveAs: false });
    for (let i = 0; i < 20; i++) {
      const [d] = await chrome.downloads.search({ id });
      if (!d || d.state === 'complete') break;
      if (d.state === 'interrupted') throw new Error(`Chrome blocked the download (${d.error}). Open a Claude Code chat so the bridge can save it instead.`);
      await sleep(250);
    }
  }
  const rows = result.tables.reduce((n, x) => n + x.rows.length, 0);
  return { ok: true, saved: true, file: `Downloads\\${base.replace(/\//g, '\\')}.md`, target: 'Claude Code', tables: result.tables.length, rows, metrics: result.metrics.length };
}

const SEO_PATTERNS = ['https://*.semrush.com/*', 'https://app.ahrefs.com/*', 'https://search.google.com/*', 'https://analytics.google.com/*',
  'https://pro.similarweb.com/*', 'https://*.moz.com/*', 'https://www.bing.com/webmasters/*'];
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-code', title: 'Save this report for Claude Code', contexts: ['page', 'selection'], documentUrlPatterns: SEO_PATTERNS });
    chrome.contextMenus.create({ id: 'send-claude', title: 'Send this report to Claude (web)', contexts: ['page', 'selection'], documentUrlPatterns: SEO_PATTERNS });
    chrome.contextMenus.create({ id: 'send-chatgpt', title: 'Send this report to ChatGPT (web)', contexts: ['page', 'selection'], documentUrlPatterns: SEO_PATTERNS });
  });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const { aiQuestion } = await chrome.storage.local.get('aiQuestion');
  if (info.menuItemId === 'save-code') return saveCapture({ tabId: tab.id, question: aiQuestion || '' }).catch(() => {});
  sendToAi({ tabId: tab.id, target: info.menuItemId === 'send-chatgpt' ? 'chatgpt' : 'claude', question: aiQuestion || '' }).catch(() => {});
});

// MV3 service workers sleep: an alarm every 30 s reconnects; an open WebSocket with traffic keeps it awake.
chrome.alarms.create('bridge', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.storage.onChanged.addListener((c) => { if (c.bridgeToken) { if (ws) ws.close(); connect(); } });
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg === 'reconnect') { connect(); reply(status); }
  if (msg && msg.type === 'sendToAi') {
    (msg.target === 'code' ? saveCapture(msg) : sendToAi(msg)).then((r) => reply({ ok: true, ...r })).catch((e) => reply({ ok: false, error: String(e && e.message || e) }));
    return true; // async reply
  }
  return false;
});
connect();
