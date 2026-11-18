// Save-through-bridge test: bridge (MCP client) + extension connected; "Claude Code (save)" must be written by the bridge
// into SEO_CAPTURES_DIR and be readable with read_capture. PW_PATH=<node_modules/playwright> node test/save-bridge-e2e.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'bridge', 'package.json'));
const { chromium } = createRequire(process.env.PW_PATH + '/package.json')('./index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const server = join(root, 'bridge', 'server.mjs');
const key = execFileSync(process.execPath, [server, '--key']).toString().trim();
const caps = mkdtempSync(join(tmpdir(), 'seo2ai-caps-'));

const c = new Client({ name: 'save-test', version: '1' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, SEO_CAPTURES_DIR: caps }, stderr: 'pipe' }));
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'seo2ai-sb-')), {
  headless: false, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
await sw.evaluate((k) => chrome.storage.local.set({ bridgeToken: k }), key);
for (let i = 0; i < 30; i++) {
  if ((await sw.evaluate(() => chrome.storage.local.get('bridgeStatus'))).bridgeStatus === 'connected') break;
  await new Promise((r) => setTimeout(r, 500));
}
const page = await ctx.newPage();
await page.goto('https://www.semrush.com/features/', { waitUntil: 'load' });
await page.waitForTimeout(1500);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.semrush.com/*' }))[0].id);
const r = await sw.evaluate((id) => saveCapture({ tabId: id, question: 'bridge save test' }), tabId);
console.log('saveCapture ->', JSON.stringify(r));
console.log('files in captures dir:', readdirSync(caps).join(', '));
const rc = await c.callTool({ name: 'read_capture', arguments: {} });
console.log('read_capture ->', rc.content[0].text.slice(0, 120).replace(/\n/g, ' | '));
console.log(r.file && r.file.startsWith(caps) && readdirSync(caps).length === 2 && rc.content[0].text.includes('bridge save test') ? 'PASS' : 'FAIL');
await ctx.close();
await c.close();
process.exit(0);
