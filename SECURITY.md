# SEO Page to AI - security model (14 Nov 2026, v0.4.1)

Goal: a user's SEO tool logins, browser and computer are never put at risk by the extension or the bridge.

## Who can do what
| Actor | Can | Cannot |
|---|---|---|
| Web pages | nothing | connect to the bridge (Origin is checked - refused even with the key); message the extension |
| The extension | read allowed SEO tool pages; open allowed SEO pages in one visible tab; paste into claude.ai / chatgpt.com when the user presses Send | read other sites, cookies or passwords; run remote code (none is loaded) |
| The bridge (local) | talk to the extension and local AI apps on 127.0.0.1; write/read captures in one folder | listen on the network (127.0.0.1 only); open non-SEO or non-https URLs; read files outside the captures folder |
| AI apps (MCP) | the 7 tools: read SEO tabs, open SEO reports, list/read saved captures | anything else on the computer |

## Controls (all tested in test/security.mjs - ALL PASS)
1. Bridge binds 127.0.0.1 only. Connections need the 24-character random key (~/.seo-page-to-ai/bridge-key).
2. Browser connections must come from a chrome-extension:// origin; web pages always send their own origin and are refused.
3. Optional pinning: ~/.seo-page-to-ai/allowed-extensions lists the extension IDs allowed (the Web Store ID once
   published) - any other extension is refused even with the key.
4. Local AI apps share the browser as "peers": no Origin header + key + role=peer.
5. URL allow-list checked twice (bridge and extension): https only, Semrush / app.ahrefs.com / Search Console / GA /
   Similarweb / Moz / Bing Webmaster. Look-alike hosts (semrush.com.evil.example) are refused.
6. At most one new page every 6 s, in one "AI" tab - human pace. Default: a visible tab. Opt-in "Hidden" mode (popup):
   the same tab in its own minimized window (still in the taskbar, never invisible); the allow-list and pace are unchanged.
7. Messages over 16 MB close that connection only; a bad connection can never crash the bridge.
8. read_capture only opens files listed in the captures folder (no path traversal); saved file names are sanitised.
9. Dead connections are dropped by a heartbeat (50-60 s).
10. No remote code, no eval, no analytics, no external servers. Manifest V3, minimal permissions (see manifest.json).

## Known limits (honest)
- Anything already running on the user's computer as the same user can read the key file - that is true for every
  local app; the bridge gives such a program no more than it already has.
- Page text is given to the AI. A hostile page could contain text that tries to steer the AI ("prompt injection");
  mitigated by the SEO-only allow-list and the human-paced, visible-by-default tab.
- The unsigned Claude desktop add-on shows Claude's standard "not verified" warning until it is signed.
