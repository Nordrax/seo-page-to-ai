const $ = (id) => document.getElementById(id);
let last = null;

// 0.4.5: example questions (owner 18 Nov). Send ones fill the question box; direct ones are copied for the AI app.
const IDEAS_SEND = [
  'Find the 5 biggest problems and what to do about each, in priority order.',
  'Which keywords are close to page 1 (positions 11-20) and worth a push?',
  'Explain this report in plain language for someone who is not an SEO expert.',
  'Which pages lost the most traffic, and what are the likely reasons?',
  'Turn this backlink report into a list of sites to contact for links.',
  'What changed compared with the previous period, and why does it matter?',
];
const IDEAS_DIRECT = [
  'Which SEO tabs do I have open?',
  'Read the SEO report I have open and give me the 5 most important findings.',
  'Read my Search Console tab and tell me which pages lost clicks.',
  'Compare the Semrush report and the Search Console report I have open - where do they disagree?',
  'Open the Semrush backlink overview for example.com and summarise the top referring domains.',
  'List my saved SEO reports and compare the newest one with the one before.',
  'From the report I have open, make a to-do list: what to fix first, why, and how long each takes.',
];
function fillIdeas() {
  const item = (text, onclick) => { const li = document.createElement('li'), b = document.createElement('button'); b.textContent = text; b.onclick = () => onclick(b); li.append(b); return li; };
  $('ideasSend').replaceChildren(...IDEAS_SEND.map((t) => item(t, () => { $('question').value = t; chrome.storage.local.set({ aiQuestion: t }); $('question').focus(); })));
  $('ideasDirect').replaceChildren(...IDEAS_DIRECT.map((t) => item(t, async (b) => {
    try { await navigator.clipboard.writeText(t); b.textContent = 'Copied ✓ - paste it in your AI app'; } catch { b.textContent = 'Copy failed - select and copy: ' + t; }
    setTimeout(() => { b.textContent = t; }, 2500);
  })));
}

async function refresh() {
  const { bridgeStatus, bridgeToken } = await chrome.storage.local.get(['bridgeStatus', 'bridgeToken']);
  // The key box is cleared after saving (security) - say plainly that a key is stored, so nobody thinks it was lost.
  $('token').placeholder = bridgeToken ? `Key saved ✓ (…${bridgeToken.slice(-4)}) - paste a new one to replace` : 'Paste your bridge key';
  const on = bridgeStatus === 'connected';
  $('dot').classList.toggle('on', on);
  $('status').textContent = on ? 'Claude Code linked - it can read your SEO tabs'
    : !bridgeToken ? 'Paste the bridge key to connect your AI'
    : 'Claude Code link off - it switches on by itself while a Claude Code chat is open. Send to AI works without it.';
}

$('save').onclick = async () => {
  const v = $('token').value.trim();
  if (!v) return;
  // The key is 24 letters/digits/-/_ (node server.mjs --key). Refuse pasted status text or anything else.
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(v)) {
    $('status').textContent = 'That is not a bridge key. Ask Claude Code to copy the key again, then paste it here.';
    $('dot').classList.remove('on');
    return;
  }
  await chrome.storage.local.set({ bridgeToken: v });
  $('token').value = '';
  setTimeout(refresh, 1500);
};
$('retry').onclick = () => chrome.runtime.sendMessage('reconnect', () => setTimeout(refresh, 1200));

$('capture').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractSeoPage, args: [{}] });
  last = result;
  const rows = result.tables.reduce((n, t) => n + t.rows.length, 0);
  $('preview').hidden = false;
  $('preview').textContent = `${result.metrics.length} key numbers, ${result.tables.length} tables, ${rows} rows\n\n` + toMarkdown(result).slice(0, 1500);
  $('copy').disabled = false;
  $('csv').disabled = !result.tables.length;
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(toMarkdown(last)); $('copy').textContent = 'Copied ✓'; } catch { $('copy').textContent = 'Copy failed'; }
};
$('csv').onclick = () => {
  const blob = new Blob([toCsv(last.tables[0])], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(last.heading || 'seo-report').replace(/[^\w-]+/g, '-').slice(0, 60)}.csv`;
  a.click();
};
// Send to AI: remembered target + question.
chrome.storage.local.get(['aiTarget3', 'aiQuestion']).then(({ aiTarget3: aiTarget, aiQuestion }) => {
  if (aiTarget) $('target').value = aiTarget;
  if (aiQuestion) $('question').value = aiQuestion;
});
chrome.storage.local.get('browseMode').then(({ browseMode }) => { $('browseMode').value = browseMode === 'background' ? 'background' : 'visible'; });
$('browseMode').onchange = () => chrome.storage.local.set({ browseMode: $('browseMode').value });
$('target').onchange = () => chrome.storage.local.set({ aiTarget3: $('target').value });
$('question').oninput = () => chrome.storage.local.set({ aiQuestion: $('question').value });
$('send').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const st = $('sendStatus');
  st.hidden = false;
  st.textContent = $('target').value === 'code' ? 'Reading and saving the report...' : 'Reading the report and opening ' + $('target').selectedOptions[0].text + '...';
  $('send').disabled = true;
  chrome.runtime.sendMessage({ type: 'sendToAi', tabId: tab.id, target: $('target').value, question: $('question').value }, (r) => {
    $('send').disabled = false;
    if (!r) { st.textContent = 'No answer from the extension - try again.'; return; }
    st.textContent = r.ok && r.saved
      ? `Saved for Claude Code: ${r.file} (${r.metrics} key numbers, ${r.tables} tables, ${r.rows} rows). In VS Code ask: "read my latest SEO capture".`
      : r.ok
      ? `${r.sent ? 'Sent' : 'Pasted'} to ${r.target}: ${r.metrics} key numbers, ${r.tables} tables, ${r.rows} rows.${r.note ? ' ' + r.note : ''}`
      : r.error;
  });
};
fillIdeas();
refresh().then(async () => {
  // Opening the popup while the link is down = try to reconnect once (e.g. after an extension update).
  const { bridgeStatus, bridgeToken } = await chrome.storage.local.get(['bridgeStatus', 'bridgeToken']);
  if (bridgeToken && bridgeStatus !== 'connected') chrome.runtime.sendMessage('reconnect', () => setTimeout(refresh, 1500));
});
