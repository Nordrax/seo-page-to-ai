// Turns an extractSeoPage() result into compact Markdown for an AI (shared by background.js and popup.js).
function toMarkdown(page) {
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
  const out = [];
  out.push(`# ${page.heading || page.title}`);
  out.push(`Source: ${page.url} (captured ${page.capturedAt})`);
  if (page.context && page.context.length) out.push(`Filters/context: ${page.context.join(' · ')}`);
  if (page.metrics && page.metrics.length) {
    out.push('', '## Key numbers');
    page.metrics.forEach((m) => out.push(`- ${m}`));
  }
  (page.tables || []).forEach((t, i) => {
    out.push('', `## ${t.name || `Table ${i + 1}`} (${t.rows.length} rows${t.truncated ? ', truncated' : ''})`);
    out.push(`| ${t.header.map(esc).join(' | ')} |`);
    out.push(`| ${t.header.map(() => '---').join(' | ')} |`);
    t.rows.forEach((r) => out.push(`| ${r.map(esc).join(' | ')} |`));
  });
  if (page.text) out.push('', '## Page text', page.text);
  return out.join('\n');
}

function toCsv(table) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return [table.header, ...table.rows].map((r) => r.map(q).join(',')).join('\n');
}
