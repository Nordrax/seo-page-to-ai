// node test/popup-ideas.mjs  (PW_PATH = a node_modules/playwright folder) - 0.4.5 popup: ideas list, key-saved placeholder.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = createRequire(process.env.PW_PATH + '/package.json')('./index.js');
const ext = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'spa-')), {
  headless: false, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--headless=new'],
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/popup.html`);
assert.equal(await page.getAttribute('#token', 'placeholder'), 'Paste your bridge key');
await page.evaluate(() => chrome.storage.local.set({ bridgeToken: 'abcdefghijklmnopqrstWXYZ' }));
await page.reload();
assert.match(await page.getAttribute('#token', 'placeholder'), /Key saved ✓ \(…WXYZ\)/);
assert.equal(await page.locator('#ideasSend li').count(), 6);
assert.equal(await page.locator('#ideasDirect li').count(), 7);
await page.click('#ideas summary');
await page.locator('#ideasSend li button').nth(1).click();
assert.match(await page.inputValue('#question'), /positions 11-20/);
await page.setViewportSize({ width: 360, height: 1100 });
await page.screenshot({ path: join(ext, 'test', 'popup-0.4.5.png'), fullPage: true });
console.log('POPUP 0.4.5 OK');
await ctx.close();
