// Live check against the user's own Chrome: starts the bridge over stdio (like Claude does), waits for the installed
// extension to connect (it retries every ~30 s), then lists SEO tabs and reads the active one.
// node test/live-check.mjs [waitSeconds=75]
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'bridge', 'package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const client = new Client({ name: 'live-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'bridge', 'server.mjs')] }));
const deadline = Date.now() + Number(process.argv[2] || 75) * 1000;
let tabs = null;
while (Date.now() < deadline) {
  const r = await client.callTool({ name: 'list_seo_tabs', arguments: {} });
  if (!r.isError) { tabs = r.content[0].text; break; }
  await new Promise((s) => setTimeout(s, 3000));
}
if (!tabs) { console.log('EXTENSION DID NOT CONNECT (key saved? extension enabled?)'); process.exit(1); }
console.log('CONNECTED. SEO tabs:', tabs.replace(/\s+/g, ' ').slice(0, 400));
const list = JSON.parse(tabs);
if (list.length) {
  const r = await client.callTool({ name: 'read_tab', arguments: { tabId: list[0].tabId } });
  console.log(r.isError ? 'read error: ' + r.content[0].text : 'READ OK: ' + r.content[0].text.slice(0, 600));
}
await client.close();
process.exit(0);
