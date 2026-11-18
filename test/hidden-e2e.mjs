// Hidden-browser mode test: real Chromium + a copy of the extension on a test port + the bridge over stdio.
// Checks that open_and_read in "background" mode reads the page from a minimized window and leaves the user's tab alone.
// node test/hidden-e2e.mjs   (PW_PATH = a node_modules/playwright folder)
import { createRequire } from 'node:module';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const PORT = '17399';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(join(root, 'bridge', 'package.json'));
const { chromium } = createRequire(process.env.PW_PATH + '/package.json')('./index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

// Extension copy that talks to the test port (never the user's real bridge).
const ext = mkdtempSync(join(tmpdir(), 'seo2ai-ext-'));
for (const f of ['manifest.json', 'background.js', 'extract.js', 'format.js', 'popup.html', 'popup.js', 'icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) cpSync(join(root, f), join(ext, f));
const bg = join(ext, 'background.js');
writeFileSync(bg, readFileSync(bg, 'utf8').replaceAll('17345', PORT));

const env = { ...process.env, SEO2AI_PORT: PORT };
const key = execFileSync(process.execPath, [join(root, 'bridge', 'server.mjs'), '--key'], { env }).toString().trim();
const client = new Client({ name: 'hidden-e2e', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'bridge', 'server.mjs')], env }));

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'seo2ai-')), {
  headless: false,
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
await sw.evaluate((k) => chrome.storage.local.set({ bridgeToken: k, browseMode: 'background' }), key);
let ok = false;
for (let i = 0; i < 60 && !ok; i++) {
  ok = (await sw.evaluate(() => chrome.storage.local.get('bridgeStatus'))).bridgeStatus === 'connected';
  if (!ok) await new Promise((r) => setTimeout(r, 500));
}
console.log('extension connected:', ok);

const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto('https://example.com/');
const results = [];
const check = (name, pass, info = '') => { results.push(pass); console.log(pass ? 'PASS' : 'FAIL', name, info); };

for (const url of ['https://www.semrush.com/features/', 'https://www.semrush.com/kb/']) {
  const r = await client.callTool({ name: 'open_and_read', arguments: { url } });
  const text = r.content[0].text;
  check(`read ${url} hidden`, !r.isError && text.length > 500, `${text.length} chars: ${text.slice(0, 80).replace(/\n/g, ' ')}`);
  const st = await sw.evaluate(async () => {
    const wins = await chrome.windows.getAll({ populate: true });
    const { aiTabId } = await chrome.storage.local.get('aiTabId');
    const aiWin = wins.find((w) => w.tabs.some((t) => t.id === aiTabId));
    const userTab = wins.flatMap((w) => w.tabs).find((t) => t.url.startsWith('https://example.com'));
    return { windows: wins.length, aiState: aiWin && aiWin.state, userActive: userTab && userTab.active };
  });
  check('AI tab is in a minimized window', st.aiState === 'minimized', JSON.stringify(st));
  check("user's tab still active", st.userActive === true);
}
const w = await sw.evaluate(async () => (await chrome.windows.getAll()).length);
check('one hidden window reused (2 windows total)', w === 2, `windows=${w}`);

await ctx.close();
await client.close();
const all = results.every(Boolean);
console.log(all ? 'ALL PASS' : 'SOME FAILED');
process.exit(all ? 0 : 1);
