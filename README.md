# SEO Page to AI

**Send the SEO report you are looking at to Claude or ChatGPT - or let Claude read your open SEO tabs itself.**

A Chrome extension plus an optional local [MCP](https://modelcontextprotocol.io) bridge. It reads the report on your
screen in **Semrush, Ahrefs, Google Search Console, Google Analytics, Similarweb, Moz and Bing Webmaster Tools** and
turns it into clean Markdown tables: the key numbers, the filters and every row, with the right column names.

- **Chrome Web Store:** https://chromewebstore.google.com/detail/seo-page-to-ai/phijoifoljpcaibghfbbcnncaiamjfgc
- **Setup guide:** https://nordrax.com/seo-page-to-ai/setup
- **Website:** https://nordrax.com/seo-page-to-ai

### Use the Semrush and Ahrefs plan you already pay for, no API units

Getting SEO data into Claude or ChatGPT usually means API access: Semrush sells API units on top of its Business plan,
and Ahrefs only includes its API on its top tier. SEO Page to AI reads the reports in the web interface you already use,
with your own login. No API key, no extra units, no extra plan. (Reports still count toward your plan's normal daily
report limit.)

No account, no Nordrax server, no tracking. Your passwords and cookies never leave the browser.

## Three ways to use it

| | Needs | What happens |
|---|---|---|
| **Send to Claude / ChatGPT** | just the extension | Opens Claude or ChatGPT in a new tab and sends the report with your question |
| **Save for Claude Code** | just the extension | Saves the report as Markdown + JSON in `Downloads/seo-captures` for your AI app to read |
| **Direct connection (MCP)** | extension + local bridge | Claude desktop, Claude Code or Cursor read your open SEO tabs and open reports you ask for |

```
Claude / Cursor  --stdio-->  bridge/server.mjs (MCP, your computer)  --ws 127.0.0.1:17345 + key-->  Chrome extension
```

## MCP tools

| Tool | What it does |
|---|---|
| `list_seo_tabs` | Lists your open tabs on supported SEO tools |
| `read_current_page` / `read_tab` | Reads a report: key numbers, filters, tables (Markdown) |
| `open_and_read(url)` | Opens an allowed SEO report URL in your browser and reads it |
| `semrush_report(report, target, db)` | Builds a Semrush report link (overview, positions, top pages, competitors, backlinks, keywords) and reads it |
| `list_captures` / `read_capture` | Lists and reads reports saved with "Save for Claude Code" |
| `get_bridge_key` | Shows the key to paste into the extension popup |

## What to ask

Direct connection:
- "Which SEO tabs do I have open?"
- "Read the SEO report I have open and give me the 5 most important findings."
- "Compare the Semrush report and the Search Console report I have open - where do they disagree?"
- "Open the Semrush backlink overview for example.com and summarise the top referring domains."
- "From the report I have open, make a to-do list: what to fix first, why, and how long each takes."

Send to Claude / ChatGPT (type in the popup):
- "Which keywords are close to page 1 (positions 11-20) and worth a push?"
- "Which pages lost the most traffic, and what are the likely reasons?"
- "Turn this backlink report into a list of sites to contact for links."

Tip: say which site it is and what you want to achieve - the answer gets much more specific.

## Install the bridge

**Claude desktop:** download `seo-page-to-ai.mcpb` from the [setup guide](https://nordrax.com/seo-page-to-ai/setup)
and double-click it.

**Claude Code / Cursor / any MCP client** (Node.js 18+):

```bash
git clone https://github.com/Nordrax/seo-page-to-ai.git
cd seo-page-to-ai/bridge && npm install
claude mcp add seo-page-to-ai -- node "$(pwd)/server.mjs"     # Claude Code
```

Then ask your AI "Give me my SEO Page to AI bridge key", paste it in the extension popup and click **Save key**.
Windows: `install-hub.ps1` keeps the bridge running from login so several AI apps share one browser connection.

## Security

The bridge listens on 127.0.0.1 only, needs a per-computer random key, refuses web pages and (optionally) any extension
ID other than the store one, and only opens https URLs on the supported SEO tools - at most one new page every 6 seconds,
in a visible tab by default. Details and known limits: [SECURITY.md](SECURITY.md). Privacy: [PRIVACY.md](PRIVACY.md).
Please report security issues privately to hello@nordrax.com.

Using a tool's web interface through an AI is still automation of your own account: keep it at human pace and check
the tool's terms.

## Development

- Load unpacked: `chrome://extensions` -> Developer mode -> **Load unpacked** -> this folder.
- Tests (real Chromium): `PW_PATH=<path to node_modules/playwright> node test/e2e.mjs` (also `security.mjs`,
  `send-e2e.mjs`, `save-e2e.mjs`, `popup-ideas.mjs`).
- Store package: `python build-chrome-zip.py` · Claude desktop add-on: `bash build-mcpb.sh`.

## License

MIT - see [LICENSE](LICENSE). Made by [Nordrax](https://nordrax.com).
