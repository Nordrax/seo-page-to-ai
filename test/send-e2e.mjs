// Send-to-AI test: real Chromium + the unpacked extension. Reads a public Semrush page, opens ChatGPT (logged-out works),
// pastes the report WITHOUT sending (autoSend false) and checks the chat box holds it.
// PW_PATH=<node_modules/playwright folder> node test/send-e2e.mjs
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(process.env.PW_PATH + '/package.json')('./index.js');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'seo2ai-send-')), {
  headless: false,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');

const page = await ctx.newPage();
await page.goto('https://www.semrush.com/features/', { waitUntil: 'load' });
await page.waitForTimeout(2000);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.semrush.com/*' }))[0].id);

const r = await sw.evaluate((id) => sendToAi({ tabId: id, target: 'chatgpt', question: 'TEST - do not answer', autoSend: false }), tabId);
console.log('sendToAi ->', JSON.stringify(r));
const ai = ctx.pages().find((p) => p.url().includes('chatgpt.com'));
await ai.waitForTimeout(1000);
await ai.screenshot({ path: join(tmpdir(), 'seo2ai-send.png') });
console.log('editors:', JSON.stringify(await ai.evaluate(() => Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).map((e) => [e.tagName, e.id, String(e.className).slice(0, 30), (e.value || e.innerText || '').length]))));
const box = await ai.evaluate(() => { const els = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')); const e = els.find((x) => (x.value || x.innerText || '').length > 0); return e ? (e.value || e.innerText) : ''; });
console.log('chat box chars:', box.length, '| starts:', JSON.stringify(box.slice(0, 80)));
console.log(box.startsWith('TEST - do not answer') && box.includes('SEO report captured from') ? 'PASS' : 'FAIL');

const bad = await sw.evaluate(async () => {
  const t = await chrome.tabs.create({ url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 2500));
  try { await sendToAi({ tabId: t.id, target: 'claude', autoSend: false }); return 'NOT REFUSED'; } catch (e) { return 'refused OK: ' + e.message.slice(0, 60); }
});
console.log('non-SEO page ->', bad);
await ctx.close();
