# feishu-user-plugin — Claude Code Instructions

## What This Is
All-in-one Feishu plugin for Claude Code with three auth layers:
- **User Identity** (cookie auth): Send messages (text, image, file, post, sticker, audio) as yourself
- **Official API** (app credentials): Read group messages, docs, tables, wiki, drive, contacts
- **User OAuth UAT** (user_access_token): Read P2P chat history, list all user's chats

## Tool Categories

### User Identity — Messaging (reverse-engineered, cookie-based)
- `send_to_user` — Search user + send text (one step, most common)
- `send_to_group` — Search group + send text (one step)
- `send_as_user` — Send text to any chat by ID, supports reply threading (root_id/parent_id)
- `send_image_as_user` — Send image (requires image_key from upload)
- `send_file_as_user` — Send file (requires file_key from upload)
- `send_post_as_user` — Send rich text with title + formatted paragraphs
- `send_sticker_as_user` — Send sticker/emoji
- `send_audio_as_user` — Send audio message

### User Identity — Contacts & Info
- `search_contacts` — Search users/groups by name
- `create_p2p_chat` — Create/get P2P chat
- `get_chat_info` — Group details (name, members, owner)
- `get_user_info` — User display name lookup
- `get_login_status` — Check cookie, app, and UAT status

### User OAuth UAT Tools (P2P chat reading)
- `read_p2p_messages` — Read P2P (direct message) chat history. chat_id accepts both numeric IDs (from create_p2p_chat) and oc_xxx format.
- `list_user_chats` — List group chats the user is in. Note: API only returns groups, not P2P. For P2P, use: `search_contacts` → `create_p2p_chat` → `read_p2p_messages`.

### Official API Tools (app credentials)
- `list_chats` / `read_messages` — Chat history (read_messages accepts chat name, auto-resolves to oc_ ID)
- `reply_message` / `forward_message` — Message operations (as bot)
- `search_docs` / `read_doc` / `create_doc` — Document operations
- `list_bitable_tables` / `list_bitable_fields` / `search_bitable_records` — Table queries
- `create_bitable_record` / `update_bitable_record` — Table writes
- `list_wiki_spaces` / `search_wiki` / `list_wiki_nodes` — Wiki
- `list_files` / `create_folder` — Drive
- `find_user` — Contact lookup by email/mobile

## Usage Patterns
- Send text as yourself → `send_to_user` or `send_to_group`
- Send rich content → `send_post_as_user` (formatted text), `send_image_as_user` (images)
- Read group chat history → `read_messages` with chat name or oc_ ID
- Read P2P chat history → `search_contacts` → `create_p2p_chat` → `read_p2p_messages`
- Reply as user in thread → `send_as_user` with root_id
- Reply as bot → `reply_message` (official API)
- Diagnose issues → `get_login_status` first

## Auth & Session
- **LARK_COOKIE**: Required for user identity tools. Session auto-refreshed every 4h via heartbeat.
- **LARK_APP_ID + LARK_APP_SECRET**: Required for official API tools.
- **LARK_USER_ACCESS_TOKEN + LARK_USER_REFRESH_TOKEN**: Required for P2P reading. Auto-refreshed via refresh_token.
- Cookie expiry: sl_session has 12h max-age, auto-refreshed by heartbeat.

## Required Environment Variables (ALL are required for full functionality)

| Variable | Purpose |
|----------|---------|
| LARK_COOKIE | User identity messaging |
| LARK_APP_ID | Official API access |
| LARK_APP_SECRET | Official API access |
| LARK_USER_ACCESS_TOKEN | P2P chat reading |
| LARK_USER_REFRESH_TOKEN | UAT auto-refresh |

All 5 must be configured. Without UAT, `read_p2p_messages` and `list_user_chats` will not work.

## Installation — MCP Server Config Format

### CRITICAL: Exact config format for `~/.claude.json` or `.mcp.json`

```json
{
  "feishu-user-plugin": {
    "command": "npx",
    "args": ["-y", "feishu-user-plugin"],
    "env": {
      "LARK_COOKIE": "<cookie-string>",
      "LARK_APP_ID": "<app-id>",
      "LARK_APP_SECRET": "<app-secret>",
      "LARK_USER_ACCESS_TOKEN": "<uat>",
      "LARK_USER_REFRESH_TOKEN": "<refresh-token>"
    }
  }
}
```

**DO NOT add `"type": "stdio"`** — Claude Code's `.mcp.json` / `~/.claude.json` does NOT use this field. Adding it causes the MCP server to fail to load. Other MCP clients (VS Code, Cursor) may use `"type"`, but Claude Code does not. Do not copy from other MCP server configs.

### If there's an existing `.env` file

Check the project's `.env` file for existing credentials (especially UAT tokens from previous OAuth runs). Include ALL found tokens in the config.

## Automated Cookie Setup via Playwright

### Prerequisites
Playwright MCP must be available. If not installed:
> Run: `npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/mcp-server-playwright` then restart Claude Code.

### Automated Flow — FOLLOW EXACTLY, DO NOT IMPROVISE

**Step 1: Clear existing browser session (MANDATORY)**

Playwright MCP uses Edge's persistent profile. It may have a cached login from a DIFFERENT Feishu account. You MUST clear cookies first:

```
browser_run_code:
  await context.clearCookies();
```

Then navigate:
```
browser_navigate: https://www.feishu.cn/messenger/
```

**Step 2: Wait for user to scan QR code**

Take a screenshot to show the QR code:
```
browser_take_screenshot
```

Tell the user: "Please scan the QR code with Feishu mobile app to log in. Make sure you use the correct account."

Poll with `browser_snapshot` every 5 seconds until the URL changes away from `/accounts/` (indicating login complete).

**Step 3: Extract cookie — TWO-STEP approach (MANDATORY)**

NEVER use `browser_run_code` output directly as the cookie string. Its output includes `### Result\n` markdown prefix, page snapshots, and console logs that contaminate the cookie.

Step 3a — Store cookie in page context via `browser_run_code`:
```js
const cookies = await page.context().cookies('https://www.feishu.cn');
const str = cookies.map(c => c.name + '=' + c.value).join('; ');
await page.evaluate(s => { window.__COOKIE__ = s; }, str);
return 'Stored ' + cookies.length + ' cookies, length=' + str.length;
```

Step 3b — Read the clean cookie string via `browser_evaluate`:
```js
window.__COOKIE__
```

This two-step approach ensures the cookie string is clean, with no markdown prefix or page content mixed in.

**Step 4: Validate BEFORE writing (MANDATORY)**

Check the cookie string:
1. Must be pure ASCII — no Chinese characters, no markdown (`###`), no HTML
2. Must contain `session=` and `sl_session=`
3. Length should be 500-5000 characters. If >10000, it is contaminated — DO NOT write it.
4. Must NOT start with `###` or contain `\n` followed by non-cookie content

If validation fails: STOP. Debug the extraction. Do NOT write a bad cookie to config.

**Step 5: Write config**

Use the EXACT format from the "Installation" section above. Include ALL env vars. Check `.env` for existing UAT tokens too.

**Step 6: Run OAuth for UAT (if not already configured)**

After writing Cookie + App credentials to config, check if LARK_USER_ACCESS_TOKEN is already available (from `.env` or previous setup). If not, the user needs to run OAuth:

Option A (if `oauth-auto.js` is available in the repo): `node src/oauth-auto.js` — uses Playwright + Cookie to auto-authorize
Option B (manual): `node src/oauth.js` — opens browser for OAuth consent

After OAuth completes, read the UAT from `.env` and add it to the MCP config.

**Step 7: Close browser and prompt restart**

```
browser_close
```

Tell user to restart Claude Code. Only ONE restart should be needed.

## Troubleshooting Guide

### If MCP tools are not available
1. Check `.mcp.json` / `~/.claude.json` config format — must NOT have `"type": "stdio"`
2. Restart Claude Code after config changes
3. After restart, tools may take a few seconds to register — if first call fails with "No such tool", wait and retry once

### If cookie authentication fails
- `document.cookie` in browser console CANNOT access HttpOnly cookies (`session`, `sl_session`)
- **Correct method**: Network tab → first request → Request Headers → Cookie → Copy value
- **Best method**: Playwright two-step extraction (see above)

### If Playwright logs into the wrong Feishu account
- Playwright uses Edge's persistent profile with cached sessions
- **ALWAYS clear cookies first** with `context.clearCookies()` before navigating to feishu.cn
- After login, verify the account by checking the URL domain (each Feishu tenant has a unique subdomain like `xxx.feishu.cn`)

### If UAT refresh fails with "invalid_grant" (error 28003/20003/20005)
- The refresh token has expired or been revoked — auto-refresh cannot recover this
- **Fix**: Re-run OAuth authorization: `node src/oauth.js` (requires LARK_APP_ID + LARK_APP_SECRET in `.env`)
- After OAuth completes, copy the new `LARK_USER_ACCESS_TOKEN` and `LARK_USER_REFRESH_TOKEN` from `.env` to your MCP config's `env` section
- Then restart Claude Code

### If `node src/oauth.js` fails with "Missing LARK_APP_ID"
- `oauth.js` reads credentials from the project's `.env` file, NOT from MCP config
- Create/update `.env` in the project root with `LARK_APP_ID=cli_xxx` and `LARK_APP_SECRET=xxx`
- Then re-run `node src/oauth.js`

### If OAuth fails with error 20029 (redirect_uri invalid)
- The Feishu app must have `http://127.0.0.1:9997/callback` registered as a redirect URI

### If list_user_chats doesn't return P2P chats
- This is expected — the API only returns group chats
- **Correct P2P flow**: `search_contacts` → `create_p2p_chat` → `read_p2p_messages`

### If UAT is missing after installation
- Check the project `.env` file for `LARK_USER_ACCESS_TOKEN` and `LARK_USER_REFRESH_TOKEN`
- These must be added to the MCP config's `env` section — the server reads from `process.env`, not from `.env` when running via npx

## Known Limitations
- Image/file upload must go through Official API or feishu-file-bridge first to obtain keys
- CARD message type (type=14) not yet implemented — complex JSON schema
