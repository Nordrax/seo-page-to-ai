// SEO Page -> AI: reads the report the user is looking at (tables, headline numbers, filters) when they click.
// Injected with chrome.scripting.executeScript({ func: extractSeoPage }). Must stay self-contained (no imports).
// Only visible, rendered content; nothing is fetched, no other pages are opened.
function extractSeoPage(options) {
  const opts = Object.assign({ maxTables: 6, maxRows: 300, maxText: 6000 }, options || {});
  const clean = (s) => (s || '').replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    // display:contents rows (Semrush DataTable) have no box of their own: visible if a child is.
    if (st.display === 'contents') return [...el.children].some(visible);
    return el.getClientRects().length > 0;
  };
  // Cell text without screen-reader-only helpers, icon labels or tooltips duplicating the value.
  const cellText = (cell) => {
    const copy = cell.cloneNode(true);
    copy.querySelectorAll('svg, button[aria-label], [aria-hidden="true"], .sr-only, [class*="visually-hidden" i], [class*="screenreader" i], [class*="tooltip" i], script, style').forEach((n) => n.remove());
    return clean(copy.innerText || copy.textContent);
  };
  // Column names: apps often put the label inside a tooltip trigger or a sort button (stripped by cellText), so fall
  // back to the cell's own label, a labelled descendant, or the raw text (Semrush Keyword Magic headers, 14 Nov).
  const headerText = (cell) => {
    const t = cellText(cell);
    if (t) return t;
    const labelled = [cell, ...cell.querySelectorAll('[aria-label], [title], [data-title]')];
    for (const n of labelled) {
      const v = clean(n.getAttribute('aria-label') || n.getAttribute('title') || n.getAttribute('data-title') || '');
      if (v && !/^(sort|sorting|info|help|more)$/i.test(v)) return v.replace(/^sort by\s+/i, '');
    }
    return clean(cell.textContent);
  };
  const isHeaderCell = (c) => c.tagName === 'TH' || c.getAttribute('role') === 'columnheader';
  const textOf = (c) => (isHeaderCell(c) ? headerText(c) : cellText(c));

  const tables = [];
  const seen = new Set();
  const pushTable = (name, rows) => {
    rows = rows.filter((r) => r.some((c) => c));
    if (rows.length < 2) return;
    const width = Math.max(...rows.map((r) => r.length));
    if (width < 2) return;
    rows = rows.map((r) => r.concat(Array(width - r.length).fill('')));
    // Header shifted against the data (Ahrefs/Semrush lists: rows start with an untitled checkbox/favicon cell, the header
    // row does not): try the header one column to the right and keep it if more titled columns then hold data.
    const data = rows.slice(1);
    const filled = (i) => data.some((r) => r[i]);
    const score = (h) => h.reduce((n, c, i) => n + (c && filled(i) ? 1 : 0), 0);
    const shifted = [''].concat(rows[0].slice(0, -1));
    if (!rows[0][width - 1] && !filled(0) && rows[0][0] && score(shifted) > score(rows[0])) rows[0] = shifted;
    // Drop columns that are empty in every row (checkbox / bookmark / action columns).
    // and the row-checkbox column ("Select all keywords" header, data repeating the next column).
    const keep = rows[0].map((h, i) => rows.some((r) => r[i]) &&
      !(/^select(\s+all)?(\s|$)/i.test(h) && rows.slice(1).every((r) => !r[i] || r[i] === r[i + 1])));
    rows = rows.map((r) => r.filter((_, i) => keep[i]));
    if (rows[0].length < 2) return;
    const sig = rows.slice(0, 3).map((r) => r.join('|')).join('/');
    if (seen.has(sig)) return;
    seen.add(sig);
    tables.push({ name, header: rows[0], rows: rows.slice(1, opts.maxRows + 1), truncated: rows.length - 1 > opts.maxRows });
  };
  const nameFor = (el) => {
    // Nearest heading above the table, or its aria-label.
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      let prev = node.previousElementSibling;
      while (prev) {
        const h = prev.matches('h1,h2,h3,h4,[role="heading"]') ? prev : prev.querySelector('h1,h2,h3,h4,[role="heading"]');
        if (h && clean(h.innerText)) return clean(h.innerText).slice(0, 120);
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  };

  // 1. Real <table> elements.
  document.querySelectorAll('table').forEach((t) => {
    if (!visible(t) || tables.length >= opts.maxTables) return;
    const rows = [...t.rows].filter(visible).map((r) => [...r.cells].map(textOf));
    pushTable(nameFor(t), rows);
  });
  // 2. ARIA grids (Semrush, Ahrefs, Search Console and most modern apps render div-based grids).
  document.querySelectorAll('[role="grid"], [role="table"], [role="treegrid"]').forEach((g) => {
    if (g.tagName === 'TABLE' || !visible(g) || tables.length >= opts.maxTables) return;
    if (g.parentElement && g.parentElement.closest('[role="grid"], [role="table"], [role="treegrid"]')) return;
    const rows = [...g.querySelectorAll('[role="row"]')].filter(visible).map((r) =>
      [...r.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"], [role="rowheader"]')]
        .filter((c) => c.closest('[role="row"]') === r)
        .map(textOf));
    pushTable(nameFor(g), rows);
  });

  // 3. Headline numbers: small blocks of "Label / value [/ change]" outside tables and charts
  //    (e.g. "Keywords 24 0%", "Authority Score 12", "Traffic Cost $0.0").
  const NUM = /^[<>~]?\s?[-+]?[$€£฿]?\s?\d[\d.,]*\s?[%KMB]?(\s?(USD|THB|EUR))?$/i;
  const asMetric = (el) => {
    if (el.closest('[role="grid"], table, svg, [role="img"], [class*="chart" i], nav, header, [role="menu"]')) return null;
    if (el.querySelectorAll('*').length > 40) return null;
    const lines = (el.innerText || '').split('\n').map(clean).filter(Boolean);
    if (lines.length < 2 || lines.length > 4) return null;
    const [label, value, ...rest] = lines;
    if (!/^[\p{L}][\p{L}\s%&/().-]{1,40}$/u.test(label) || !NUM.test(value)) return null;
    return `${label}: ${value}${rest.length ? ' (' + rest.join(', ') + ')' : ''}`;
  };
  const metrics = [];
  const main0 = document.querySelector('main, [role="main"]') || document.body;
  main0.querySelectorAll('div, section, li, a, button, dl').forEach((el) => {
    if (metrics.length >= 30 || !visible(el)) return;
    const m = asMetric(el);
    if (!m) return;
    // keep the innermost block: skip if a child block gives a metric too
    if ([...el.children].some((c) => asMetric(c))) return;
    if (!metrics.includes(m)) metrics.push(m);
  });

  // 4. Filters / context the report was run with (database, date, device, search query).
  const context = [];
  document.querySelectorAll('[aria-pressed="true"], [aria-selected="true"], [role="combobox"], select').forEach((el) => {
    if (!visible(el) || el.closest('[role="grid"], table') || context.length >= 20) return;
    const t = clean(el.innerText || el.value || el.getAttribute('aria-label'));
    if (t && t.length < 60 && !context.includes(t)) context.push(t);
  });

  const main = document.querySelector('main, [role="main"]') || document.body;
  const h1 = clean((document.querySelector('h1') || {}).innerText || '');
  return {
    url: location.href,
    site: location.hostname,
    title: clean(document.title),
    heading: h1,
    capturedAt: new Date().toISOString(),
    context,
    metrics,
    tables,
    text: tables.length ? '' : clean(main.innerText).slice(0, opts.maxText),
  };
}
