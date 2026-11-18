// Save-for-Claude-Code test: real Chromium + the unpacked extension. Reads a public Semrush page, saves it as
// seo-captures/<stamp>_<page>.md/.json via chrome.downloads, then checks the files' content.
// PW_PATH=<node_modules/playwright> node test/save-e2e.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(process.env.PW_PATH + '/package.json')('./index.js');
const dl = mkdtempSync(join(tmpdir(), 'seo2ai-dl-'));
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'seo2ai-save-')), {
  headless: false, acceptDownloads: true, downloadsPath: dl,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const page = await ctx.newPage();
await page.goto('https://www.semrush.com/features/', { waitUntil: 'load' });
await page.waitForTimeout(2000);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.semrush.com/*' }))[0].id);
const r = await sw.evaluate((id) => saveCapture({ tabId: id, question: 'Which features matter for an escort directory?' }), tabId);
console.log('saveCapture ->', JSON.stringify(r));
await page.waitForTimeout(3000);
const items = await sw.evaluate(() => new Promise((res) => chrome.downloads.search({}, (x) => res(x.map((d) => ({ f: d.filename, state: d.state, err: d.error }))))));
console.log('downloads:', JSON.stringify(items));
const files = readdirSync(dl);
const bodies = files.map((f) => readFileSync(join(dl, f), 'utf8'));
const md = bodies.find((b) => b.startsWith('Question:'));
const js = bodies.find((b) => b.trim().startsWith('{'));
console.log('files in download dir:', files.length, '| md starts:', JSON.stringify((md || '').slice(0, 90)), '| json ok:', !!(js && JSON.parse(js).url));
console.log(r.saved && md && md.includes('semrush.com/features') && js ? 'PASS' : 'FAIL');
await ctx.close();
