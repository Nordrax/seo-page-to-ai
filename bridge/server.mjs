#!/usr/bin/env node
// SEO Page to AI - local MCP bridge. Claude Desktop / Claude Code / Cursor start this over stdio; it forwards tool
// calls to the browser extension over a WebSocket on 127.0.0.1 only. The extension must present the bridge key and
// connect from a chrome-extension:// origin, so web pages cannot talk to the bridge.
//   node server.mjs            run as an MCP server (stdio)
//   node server.mjs --key      print the bridge key to paste into the extension once
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const PORT = Number(process.env.SEO2AI_PORT) || 17345; // SEO2AI_PORT only for tests
const DIR = join(homedir(), '.seo-page-to-ai');
const KEY_FILE = join(DIR, 'bridge-key');
mkdirSync(DIR, { recursive: true });
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(18).toString('base64url'), { mode: 0o600 });
const KEY = readFileSync(KEY_FILE, 'utf8').trim();
const ALLOW_FILE = join(DIR, 'allowed-extensions');
const allowedExtensions = () => (existsSync(ALLOW_FILE) ? readFileSync(ALLOW_FILE, 'utf8').split(/\s+/).filter(Boolean) : []);
const MAX_MESSAGE = 16 * 1024 * 1024; // a captured report is well under this; bigger frames are refused
// The bridge itself only opens these hosts (the extension checks the same list - two independent checks).
const SEO_HOSTS = [/(^|\.)semrush\.com$/, /^app\.ahrefs\.com$/, /^search\.google\.com$/, /^analytics\.google\.com$/,
  /^pro\.similarweb\.com$/, /(^|\.)moz\.com$/, /^www\.bing\.com$/];
const seoUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && SEO_HOSTS.some((re) => re.test(x.hostname)); } catch { return false; } };
if (process.argv.includes('--key')) { console.log(KEY); process.exit(0); }
// --hub: run only the shared hub (no MCP over stdio) - started at Windows login so the extension is always connected;
// every Claude app's bridge then joins as a peer. If another app owns the port it waits and takes over when it closes.
const HUB_ONLY = process.argv.includes('--hub');
const log = (...a) => console.error('[seo-page-to-ai]', ...a); // stdout belongs to the MCP protocol
const CAPTURES = process.env.SEO_CAPTURES_DIR || join(homedir(), 'Downloads', 'seo-captures');

// --- extension link (hub) / sharing between AI apps (peer) ---------------------------------------------------
// The first bridge to start (Claude Code, Claude Desktop, Cursor...) owns port 17345 = the HUB: the browser extension connects
// to it. Every later bridge becomes a PEER: it connects to the hub with the same key and forwards its tool calls, so several
// AI apps can use the one browser at the same time. If the hub exits, a peer takes the port over.
// Who may connect: the extension (chrome-extension:// origin + key) or a local peer (no Origin header + key + role=peer).
// Web pages always send an Origin, so they can never connect, even with the key.
let role = 'starting';
let ext = null;            // hub: the extension socket
let hubSocket = null;      // peer: socket to the hub
const pending = new Map(); // id -> {resolve, reject, timer}

function settle(msg) {
  const p = msg.id && pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
}

// A dropped link (hub app quit / extension gone) fails its waiting calls at once, so the AI can retry right away.
function failPending(reason) {
  for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); pending.delete(id); }
}

function startHub() {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: PORT,
    maxPayload: MAX_MESSAGE,
    verifyClient: ({ origin, req }, done) => {
      const q = new URL(req.url, 'http://x').searchParams;
      if (q.get('token') !== KEY) return done(false, 401);
      if (String(origin || '').startsWith('chrome-extension://')) {
        const pinned = allowedExtensions();
        return pinned.length && !pinned.includes(String(origin).slice('chrome-extension://'.length)) ? done(false, 403) : done(true);
      }
      if (!origin && q.get('role') === 'peer') return done(true);
      return done(false, 403);
    },
  });
  wss.on('listening', () => { role = 'hub'; log('hub: waiting for the browser extension on port', PORT); });
  wss.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      // Standby: another app (e.g. Claude desktop) is the hub now; take the port over as soon as it closes.
      if (HUB_ONLY) { setTimeout(startHub, 15000); return; }
      role = 'peer'; connectPeer();
    } else log('bridge error:', e.message);
  });
  wss.on('connection', (socket, req) => {
    // A bad frame (too big, malformed) closes only that connection - never crash the bridge.
    socket.on('error', (e) => log('connection error:', e.message));
    const isPeer = new URL(req.url, 'http://x').searchParams.get('role') === 'peer';
    if (isPeer) {
      log('peer connected (another AI app shares this browser)');
      socket.on('message', async (raw) => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (!msg.id || !msg.tool) return;
        try { socket.send(JSON.stringify({ id: msg.id, ok: true, result: await callExtension(msg.tool, msg.args, msg.timeoutMs) })); }
        catch (e) { socket.send(JSON.stringify({ id: msg.id, ok: false, error: e.message })); }
      });
      return;
    }
    if (ext) ext.close();
    ext = socket;
    log('extension connected');
    // Heartbeat: the extension answers every ping with a pong. A socket that stays silent for 50 s is dead (Chrome froze or
    // killed the extension without closing it) - drop it so calls fail fast and the extension reconnects.
    let lastSeen = Date.now();
    const ping = setInterval(() => {
      if (Date.now() - lastSeen > 50000) { log('extension silent for 50 s - dropping the link'); return socket.terminate(); }
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
    }, 20000);
    socket.on('message', () => { lastSeen = Date.now(); });
    socket.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'save') return saveFromExtension(socket, msg);
      settle(msg);
    });
    socket.on('close', () => { clearInterval(ping); if (ext === socket) { ext = null; failPending('The browser extension disconnected.'); } log('extension disconnected'); });
  });
}

// Extension "Claude Code (save)": write <name>.md + .json into the captures folder (name sanitised, folder fixed).
function saveFromExtension(socket, msg) {
  try {
    const name = String(msg.name || 'seo-report').replace(/[^\w.-]+/g, '-').slice(0, 120);
    mkdirSync(CAPTURES, { recursive: true });
    let file = join(CAPTURES, `${name}.md`);
    for (let i = 2; existsSync(file); i++) file = join(CAPTURES, `${name}-${i}.md`);
    writeFileSync(file, String(msg.md || ''), 'utf8');
    writeFileSync(file.replace(/\.md$/, '.json'), String(msg.json || '{}'), 'utf8');
    log('saved capture', file);
    socket.send(JSON.stringify({ type: 'saved', id: msg.id, ok: true, result: { file } }));
  } catch (e) {
    socket.send(JSON.stringify({ type: 'saved', id: msg.id, ok: false, error: e.message }));
  }
}

function connectPeer() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${encodeURIComponent(KEY)}&role=peer`, { maxPayload: MAX_MESSAGE });
  ws.on('open', () => { hubSocket = ws; log('peer: sharing the browser through the running bridge'); });
  ws.on('message', (raw) => { try { settle(JSON.parse(raw)); } catch { /* ignore */ } });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (hubSocket === ws) hubSocket = null;
    failPending('The shared bridge restarted - try again in a few seconds.');
    // Hub gone (its AI app closed): try to take the port over, else reconnect as a peer.
    setTimeout(startHub, 500 + Math.floor(Math.random() * 1500));
  });
}

function callExtension(tool, args = {}, timeoutMs = 120000) {
  const target = role === 'hub' ? ext : hubSocket;
  if (!target || target.readyState !== 1) {
    return Promise.reject(new Error('The browser extension is not connected. Install "SEO Page to AI" in Chrome, then call get_bridge_key and paste the key into the extension popup (Bridge key -> Save key). Setup guide: https://nordrax.com/seo-page-to-ai/setup'));
  }
  const id = randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${tool} timed out`)); }, timeoutMs + 5000);
    pending.set(id, { resolve, reject, timer });
    target.send(JSON.stringify({ id, tool, args, timeoutMs }));
  });
}
startHub();

// --- Semrush report links (the user's own logged-in browser opens them) ------------------------------------
const SEMRUSH = {
  domain_overview: (t, db) => `https://www.semrush.com/analytics/overview/?q=${t}&db=${db}&searchType=domain`,
  organic_positions: (t, db) => `https://www.semrush.com/analytics/organic/positions/?q=${t}&db=${db}&searchType=domain`,
  top_pages: (t, db) => `https://www.semrush.com/analytics/organic/pages/?q=${t}&db=${db}&searchType=domain`,
  organic_competitors: (t, db) => `https://www.semrush.com/analytics/organic/competitors/?q=${t}&db=${db}&searchType=domain`,
  backlinks_overview: (t) => `https://www.semrush.com/analytics/backlinks/overview/?q=${t}&searchType=domain`,
  backlinks: (t) => `https://www.semrush.com/analytics/backlinks/backlinks/?q=${t}&searchType=domain`,
  referring_domains: (t) => `https://www.semrush.com/analytics/backlinks/backlinks/?q=${t}&searchType=domain`, // refdomains/ redirects to overview (Nov 2026)
  keyword_overview: (t, db) => `https://www.semrush.com/analytics/keywordoverview/?q=${t}&db=${db}`,
  keyword_magic: (t, db) => `https://www.semrush.com/analytics/keywordmagic/?q=${t}&db=${db}`,
};

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const asText = (r) => text(r.markdown ? `${r.markdown}\n\n(${r.tables} tables, ${r.rows} rows)` : JSON.stringify(r, null, 2));

const server = new McpServer({ name: 'seo-page-to-ai', version: '0.1.0' });

server.tool('read_current_page',
  'Read the SEO report the user is looking at in their browser (Semrush, Ahrefs, Search Console, GA, Similarweb, Moz, Bing Webmaster): key numbers, filters and tables as Markdown.',
  {}, async () => asText(await callExtension('read_current_page')));

server.tool('get_bridge_key',
  'Get the key that connects the SEO Page to AI Chrome extension to this computer. Use when the user asks for their bridge key or when the extension is not connected. Show the key to the user with the 3 steps returned.',
  {}, async () => text(`Your SEO Page to AI bridge key: ${KEY}\n\n1. Click the SEO Page to AI icon in Chrome.\n2. Paste the key in "Bridge key" and click "Save key".\n3. The popup shows "connected" within a few seconds.\n\nThe key only works on this computer (the bridge listens on 127.0.0.1). Guide: https://nordrax.com/seo-page-to-ai/setup`));

server.tool('list_seo_tabs', 'List the open browser tabs on supported SEO tools (tabId, title, url).',
  {}, async () => text(JSON.stringify(await callExtension('list_tabs'), null, 2)));

server.tool('read_tab', 'Read one open SEO tool tab by tabId (from list_seo_tabs).',
  { tabId: z.number().int() }, async ({ tabId }) => asText(await callExtension('read_tab', { tabId })));

server.tool('open_and_read',
  'Open a report URL on a supported SEO tool in the user\'s browser (a visible tab, their own login), wait for it to load and read it. Human pace: at most one new page every few seconds. Prefer read_current_page when the user already has the report open.',
  { url: z.string().url() }, async ({ url }) => {
    if (!seoUrl(url)) throw new Error(`Refused: only https pages on Semrush, Ahrefs, Search Console, GA, Similarweb, Moz and Bing Webmaster can be opened (${url}).`);
    return asText(await callExtension('open_and_read', { url }, 180000));
  });

server.tool('semrush_report',
  'Open a Semrush report for a domain or keyword in the user\'s logged-in browser and read it. Uses their Semrush plan through the normal web interface (no API units). db = Semrush country database, e.g. us, uk, th, no, se.',
  {
    report: z.enum(Object.keys(SEMRUSH)),
    target: z.string().min(1).describe('Domain (example.com) for domain reports, keyword for keyword_overview / keyword_magic'),
    db: z.string().regex(/^[a-z]{2}$/).default('us'),
  },
  async ({ report, target, db }) => asText(await callExtension('open_and_read', { url: SEMRUSH[report](encodeURIComponent(target.trim()), db) }, 180000)));

// --- Saved captures (extension "Claude Code (save)"): readable even when the extension is not connected ----------------
const captureFiles = () => (existsSync(CAPTURES) ? readdirSync(CAPTURES).filter((f) => f.endsWith('.md'))
  .map((f) => ({ f, t: statSync(join(CAPTURES, f)).mtimeMs })).sort((a, b) => b.t - a.t) : []);

server.tool('list_captures', `List SEO reports the user saved from the browser with the extension (newest first). Folder: ${CAPTURES}`,
  { limit: z.number().int().min(1).max(100).default(20) },
  async ({ limit }) => {
    const files = captureFiles().slice(0, limit);
    return text(files.length ? files.map((x) => `${new Date(x.t).toISOString().slice(0, 16).replace('T', ' ')}  ${x.f}`).join('\n')
      : `No saved captures yet in ${CAPTURES}. In Chrome: open a report, click the extension, choose "Claude Code (save)", press Send.`);
  });

server.tool('read_capture', 'Read a saved SEO report (Markdown). name = file name from list_captures; omit for the newest one.',
  { name: z.string().optional() },
  async ({ name }) => {
    const files = captureFiles();
    const pick = name ? files.find((x) => x.f === name || x.f.startsWith(name)) : files[0];
    if (!pick) return text(name ? `No capture named ${name}` : `No saved captures yet in ${CAPTURES}.`);
    return text(`(${pick.f})\n\n` + readFileSync(join(CAPTURES, pick.f), 'utf8'));
  });

if (HUB_ONLY) log('hub-only mode (no MCP stdio)'); else await server.connect(new StdioServerTransport());
log(`MCP bridge ready; waiting for the extension on ws://127.0.0.1:${PORT}`);
