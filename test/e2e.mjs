// End-to-end test: real Chromium + the unpacked extension + the MCP bridge started over stdio, like Claude does.
// node test/e2e.mjs   (needs playwright resolvable; set PW_PATH to a node_modules/playwright folder)
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(join(root, 'bridge', 'package.json'));
const { chromium } = createRequire(process.env.PW_PATH + '/package.json')('./index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const key = execFileSync(process.execPath, [join(root, 'bridge', 'server.mjs'), '--key']).toString().trim();
const client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'bridge', 'server.mjs')] }));
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));

const profile = mkdtempSync(join(tmpdir(), 'seo2ai-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
await sw.evaluate((k) => chrome.storage.local.set({ bridgeToken: k }), key);
for (let i = 0; i < 30; i++) {
  const s = await sw.evaluate(() => chrome.storage.local.get('bridgeStatus'));
  if (s.bridgeStatus === 'connected') { console.log('extension connected to bridge'); break; }
  await new Promise((r) => setTimeout(r, 500));
}

const r1 = await client.callTool({ name: 'open_and_read', arguments: { url: 'https://www.semrush.com/features/' } });
console.log('open_and_read ->', r1.isError ? 'ERROR ' : '', r1.content[0].text.slice(0, 300).replace(/\n/g, ' | '));
const r2 = await client.callTool({ name: 'list_seo_tabs', arguments: {} });
console.log('list_seo_tabs ->', r2.content[0].text.slice(0, 200).replace(/\n/g, ' '));
const r3 = await client.callTool({ name: 'open_and_read', arguments: { url: 'https://example.com/' } });
console.log('blocked site ->', r3.isError ? 'refused OK:' : 'NOT REFUSED!', r3.content[0].text.slice(0, 120));

await ctx.close();
await client.close();
process.exit(0);
