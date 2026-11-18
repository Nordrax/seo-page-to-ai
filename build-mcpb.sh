#!/bin/bash
# Builds dist/seo-page-to-ai.mcpb (one-click Claude Desktop add-on) from bridge/. Usage: bash build-mcpb.sh
set -e
cd "$(dirname "$0")"
V=$(node -p "require('./manifest.json').version")
rm -rf dist/mcpb && mkdir -p dist/mcpb/server
cp bridge/server.mjs bridge/package.json dist/mcpb/server/
cp icon128.png dist/mcpb/icon.png
(cd dist/mcpb/server && npm install --omit=dev --no-audit --no-fund --silent)
cat > dist/mcpb/manifest.json <<JSON
{
  "manifest_version": "0.2",
  "name": "seo-page-to-ai",
  "display_name": "SEO Page to AI",
  "version": "$V",
  "description": "Lets Claude read the SEO reports in your own browser: Semrush, Ahrefs, Search Console, GA, Similarweb, Moz, Bing.",
  "long_description": "Works with the SEO Page to AI Chrome extension. Claude reads the report you have open, your other SEO tabs, or opens Semrush reports in a visible tab using your own login and plan (no API units). Several Claude apps can share the browser at once. Also reads reports you saved with the extension (Downloads/seo-captures).",
  "author": { "name": "Nordrax" },
  "icon": "icon.png",
  "server": {
    "type": "node",
    "entry_point": "server/server.mjs",
    "mcp_config": { "command": "node", "args": ["\${__dirname}/server/server.mjs"] }
  },
  "tools": [
    { "name": "read_current_page", "description": "Read the SEO report open in the browser" },
    { "name": "get_bridge_key", "description": "Show the key to paste into the Chrome extension" },
    { "name": "list_seo_tabs", "description": "List open SEO tool tabs" },
    { "name": "read_tab", "description": "Read one SEO tab" },
    { "name": "open_and_read", "description": "Open an SEO report URL in a visible tab and read it" },
    { "name": "semrush_report", "description": "Open and read a Semrush report for a domain or keyword" },
    { "name": "list_captures", "description": "List reports saved with the extension" },
    { "name": "read_capture", "description": "Read a saved report" }
  ],
  "compatibility": { "platforms": ["win32", "darwin"], "runtimes": { "node": ">=18.0.0" } }
}
JSON
npx -y @anthropic-ai/mcpb@latest validate dist/mcpb/manifest.json
npx -y @anthropic-ai/mcpb@latest pack dist/mcpb dist/seo-page-to-ai.mcpb
echo "BUILT dist/seo-page-to-ai.mcpb ($V)"
