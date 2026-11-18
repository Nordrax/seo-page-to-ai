# SEO Page to AI - Privacy Policy

Last updated: 14 November 2026

SEO Page to AI is a browser extension (with an optional local helper, the "bridge") that turns the SEO report you are
looking at into text and tables for an AI assistant of your choice.

## What the extension reads
- Only pages on these SEO tools: Semrush, Ahrefs (app.ahrefs.com), Google Search Console, Google Analytics, Similarweb,
  Moz and Bing Webmaster Tools - and only when you press a button (Read / Send / Save, the right-click menu) or when your
  own AI assistant asks through the bridge you installed.
- It reads what is visible in the report: headings, key numbers, filters and tables. It does not read passwords, cookies,
  form fields, or any other website.

## Where the data goes
- **Claude Code (save):** to your own computer - the bridge writes a file into your Downloads\seo-captures folder (or the
  browser downloads it there).
- **Claude / ChatGPT (web):** to the AI website you picked, in a new tab, under your own login. That site's own privacy
  policy applies to what you send there.
- **Bridge (Claude desktop app, Claude Code, Cursor):** to the AI app on your own computer, over a local connection
  (127.0.0.1) protected by a secret key. Nothing is sent over the internet by the extension or the bridge.

We (the developer) run no server for this extension and receive no data at all: no analytics, no tracking, no
advertising, no accounts. Nothing is sold or shared.

## What is stored
- In the browser: your bridge key, your chosen AI and question, the connection status and the last captured report
  (chrome.storage.local, on your computer only). Removing the extension deletes them.
- On your computer: the captures you save (Downloads\seo-captures) and the bridge key file (~/.seo-page-to-ai). You can
  delete them at any time.

## Your SEO tool accounts
The extension uses the SEO tools through your normal browser login, at human pace (one page at a time, in a visible tab or - if you choose - a minimized window).
Your passwords never leave the browser and are never read. Using a tool's interface through an AI is still use of your
account - check the tool's terms.

## Contact
Questions or deletion requests: hello@nordrax.com (publisher: Nordrax). Public copy: https://nordrax.com/seo-page-to-ai/privacy
