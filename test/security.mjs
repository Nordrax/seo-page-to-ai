// Security test for the bridge (no browser needed). Starts a private bridge on the normal port, so run it while no other
// bridge is running (or it joins as a peer and checks 1-4 against the running one). node test/security.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'bridge', 'package.json'));
const { WebSocket } = require('ws');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const PORT = 17399;
process.env.SEO2AI_PORT = String(PORT);
const KEY = readFileSync(join(homedir(), '.seo-page-to-ai', 'bridge-key'), 'utf8').trim();
const ALLOW = join(homedir(), '.seo-page-to-ai', 'allowed-extensions');
const results = [];
const check = (name, ok) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name); };
const tryWs = (q, headers = {}) => new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?${q}`, { headers });
  ws.on('open', () => { ws.close(); res('open'); });
  ws.on('unexpected-response', (_r, resp) => res(String(resp.statusCode)));
  ws.on('error', () => res('error'));
});

const c = new Client({ name: 'sec', version: '1' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'bridge', 'server.mjs')], env: { ...process.env, SEO2AI_PORT: String(PORT) }, stderr: 'ignore' }));
await new Promise((r) => setTimeout(r, 1200));

check('web page origin with the right key is refused', (await tryWs(`token=${KEY}`, { Origin: 'https://evil.example' })) !== 'open');
check('extension origin with a wrong key is refused', (await tryWs('token=wrong', { Origin: 'chrome-extension://abc' })) !== 'open');
check('no origin without role=peer is refused', (await tryWs(`token=${KEY}`)) !== 'open');
check('local peer with the key is accepted', (await tryWs(`token=${KEY}&role=peer`)) === 'open');
check('extension origin with the key is accepted (no pin)', (await tryWs(`token=${KEY}`, { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' })) === 'open');
const hadPin = existsSync(ALLOW) ? readFileSync(ALLOW, 'utf8') : null;
writeFileSync(ALLOW, 'pinnedextensionidpinnedextension\n');
check('pinned: other extension ID refused', (await tryWs(`token=${KEY}`, { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' })) !== 'open');
check('pinned: pinned extension ID accepted', (await tryWs(`token=${KEY}`, { Origin: 'chrome-extension://pinnedextensionidpinnedextension' })) === 'open');
if (hadPin === null) rmSync(ALLOW); else writeFileSync(ALLOW, hadPin);
const big = await new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${KEY}&role=peer`);
  ws.on('open', () => ws.send('x'.repeat(17 * 1024 * 1024)));
  ws.on('close', (code) => res(code));
  ws.on('error', () => {});
  setTimeout(() => res('still open'), 5000);
});
check('oversized message closes the connection', big === 1009 || big === 1006);
for (const url of ['https://example.com/', 'http://www.semrush.com/', 'file:///C:/Windows/win.ini', 'https://semrush.com.evil.example/']) {
  const r = await c.callTool({ name: 'open_and_read', arguments: { url } }).catch((e) => ({ isError: true, content: [{ text: e.message }] }));
  check(`bridge refuses to open ${url}`, r.isError && /Refused|Invalid|url/i.test(r.content[0].text));
}
const rc = await c.callTool({ name: 'read_capture', arguments: { name: '../../.seo-page-to-ai/bridge-key' } });
check('read_capture cannot read files outside the captures folder', !rc.content[0].text.includes(KEY));
await c.close();
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
