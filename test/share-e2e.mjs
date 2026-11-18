// Sharing test: two MCP clients (like Claude Code + Claude Desktop) start two bridges; the first is the hub, the second
// a peer. Both must read the browser. Then the hub app closes and the peer must take over.
// PW_PATH=<node_modules/playwright> node test/share-e2e.mjs
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'bridge', 'package.json'));
const { chromium } = createRequire(process.env.PW_PATH + '/package.json')('./index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = join(root, 'bridge', 'server.mjs');
const key = execFileSync(process.execPath, [server, '--key']).toString().trim();

const app = async (name) => {
  const c = new Client({ name, version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [server], stderr: 'pipe' }));
  return c;
};
const tabs = async (c) => {
  for (let i = 0; i < 40; i++) {
    const r = await c.callTool({ name: 'list_seo_tabs', arguments: {} });
    if (!r.isError) return JSON.parse(r.content[0].text).length + ' SEO tab(s)';
    await sleep(2000);
  }
  return 'FAILED';
};

const A = await app('claude-code');
await sleep(800);
const B = await app('claude-desktop');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'seo2ai-share-')), {
  headless: false, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
await sw.evaluate((k) => chrome.storage.local.set({ bridgeToken: k }), key);
const page = await ctx.newPage();
await page.goto('https://www.semrush.com/features/', { waitUntil: 'load' });

const a1 = await tabs(A);
const b1 = await tabs(B);
console.log('app A (hub):', a1, '| app B (peer):', b1);
await A.close(); // the hub app quits
console.log('app A closed; waiting for B to take over and the extension to reconnect...');
const b2 = await tabs(B);
console.log('app B after takeover:', b2);
console.log(!a1.startsWith('FAILED') && !b1.startsWith('FAILED') && !b2.startsWith('FAILED') ? 'PASS' : 'FAIL');
await B.close();
await ctx.close();
process.exit(0);
