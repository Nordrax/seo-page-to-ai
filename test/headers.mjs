// Header extraction test: a Semrush-style ARIA grid whose column names sit inside tooltip triggers / sort buttons,
// plus a row-checkbox column. PW_PATH=<node_modules/playwright> node test/headers.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(process.env.PW_PATH + '/package.json')('./index.js');
const b = await chromium.launch();
const p = await b.newPage();
const hdr = (label) => `<div role="columnheader"><span class="tooltip-trigger___x">${label}</span><button aria-label="Sort"></button></div>`;
const row = (k, v, kd) => `<div role="row"><div role="gridcell"><input type="checkbox"><span>${k}</span></div><div role="gridcell">${k}</div><div role="gridcell">${v}</div><div role="gridcell">${kd}</div></div>`;
await p.setContent(`<h2>Keyword Magic Tool: eskorter</h2><div role="grid">
  <div role="row"><div role="columnheader" aria-label="Select all keywords"><input type="checkbox"></div>${hdr('Keyword')}${hdr('Volume')}<div role="columnheader"><button aria-label="KD %"></button></div></div>
  ${row('eskorte', '110,000', '14')}${row('eskorte oslo', '12,100', '57')}</div>`);
await p.addScriptTag({ content: readFileSync(join(root, 'extract.js'), 'utf8') });
let r = await p.evaluate(() => extractSeoPage({}));
// Ahrefs-style: header has no checkbox column, every row starts with an empty checkbox cell, header ends with an empty cell.
const ah = await b.newPage();
const th = (x) => `<div role="columnheader">${x}</div>`;
const td = (x) => `<div role="gridcell">${x}</div>`;
await ah.setContent(`<div role="grid"><div role="row">${th('Keyword') + th('Volume') + th('KD') + th('Position') + th('')}</div>
  <div role="row">${td('<input type=checkbox>') + td('eskorte') + td('36K') + td('67') + td('2')}</div>
  <div role="row">${td('<input type=checkbox>') + td('escort bergen') + td('2.4K') + td('24') + td('2')}</div></div>`);
await ah.addScriptTag({ content: readFileSync(join(root, 'extract.js'), 'utf8') });
const a = (await ah.evaluate(() => extractSeoPage({}))).tables[0];
console.log('ahrefs header:', JSON.stringify(a.header), 'row1:', JSON.stringify(a.rows[0]));
const ahOk = JSON.stringify(a.header) === JSON.stringify(['Keyword', 'Volume', 'KD', 'Position']) && a.rows[0][0] === 'eskorte' && a.rows[0][1] === '36K';
const t = r.tables[0];
console.log('header:', JSON.stringify(t.header), 'row1:', JSON.stringify(t.rows[0]));
console.log(JSON.stringify(t.header) === JSON.stringify(['Keyword', 'Volume', 'KD %']) && t.rows[0][0] === 'eskorte' && ahOk ? 'PASS' : 'FAIL');
await b.close();
