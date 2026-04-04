# feishu-user-plugin — Claude Code Instructions

## What This Is
All-in-one Feishu plugin for Claude Code with three auth layers:
- **User Identity** (cookie auth): Send messages (text, image, file, post, sticker, audio) as yourself
- **Official API** (app credentials): Read group messages, docs, tables, wiki, drive, contacts, upload files
- **User OAuth UAT** (user_access_token): Read P2P chat history, list all user's chats

## Tool Categories (76 tools)

### User Identity — Messaging (reverse-engineered, cookie-based)
- `send_to_user` — Search user + send text (one step, most common). Returns candidates if multiple matches.
- `send_to_group` — Search group + send text (one step). Returns candidates if multiple matches.
- `send_as_user` — Send text to any chat by ID, supports reply threading (root_id/parent_id)
- `send_image_as_user` — Send image (requires image_key from `upload_image`)
- `send_file_as_user` — Send file (requires file_key from `upload_file`)
- `send_post_as_user` — Send rich text with title + formatted paragraphs
- `send_sticker_as_user` — Send sticker/emoji
- `send_audio_as_user` — Send audio message

### User Identity — Contacts & Info
- `search_contacts` — Search users/groups by name
- `create_p2p_chat` — Create/get P2P chat
- `get_chat_info` — Group details (name, members, owner). Supports both oc_xxx and numeric chat_id (Official API + protobuf fallback)
- `get_user_info` — User display name lookup (official API first, cookie cache fallback)
- `get_login_status` — Check cookie, app, and UAT status

### User OAuth UAT Tools (P2P chat reading)
- `read_p2p_messages` — Read P2P (direct message) chat history. chat_id accepts both numeric IDs (from create_p2p_chat) and oc_xxx format. Returns newest messages first by default.
- `list_user_chats` — List group chats the user is in. Note: API only returns groups, not P2P. For P2P, use: `search_contacts` → `create_p2p_chat` → `read_p2p_messages`.

### Official API Tools (app credentials)
- `list_chats` / `read_messages` — Chat history (read_messages accepts chat name, oc_ ID, or numeric ID; auto-resolves via bot's group list → im.chat.search → search_contacts). **Auto-falls back to UAT for external groups the bot cannot access.** Returns newest messages first by default. Messages include sender names.
- `send_message_as_bot` — Bot sends message to any chat (text, post, interactive, etc.)
- `reply_message` / `forward_message` — Message operations (as bot)
- `delete_message` / `update_message` — Recall or edit bot's own messages
- `add_reaction` / `delete_reaction` — Emoji reactions on messages
- `pin_message` / `unpin_message` — Pin/unpin messages in chat
- `create_group` / `update_group` — Create and manage group chats
- `list_members` / `add_members` / `remove_members` — Group membership management
- `search_docs` / `read_doc` / `get_doc_blocks` / `create_doc` — Document operations
- `create_doc_block` / `update_doc_block` / `delete_doc_blocks` — Document content editing (insert/update/delete blocks)
- `create_bitable` — Create a new Bitable (multi-dimensional table) app
- `list_bitable_tables` / `create_bitable_table` — Table management
- `list_bitable_fields` / `create_bitable_field` / `update_bitable_field` / `delete_bitable_field` — Field (column) management
- `list_bitable_views` — List views in a table
- `search_bitable_records` — Query records with filter/sort
- `create_bitable_record` / `update_bitable_record` / `delete_bitable_record` — Single record CRUD
- `batch_create_bitable_records` / `batch_update_bitable_records` / `batch_delete_bitable_records` — Batch operations (max 500/call)
- `list_wiki_spaces` / `search_wiki` / `list_wiki_nodes` — Wiki
- `list_files` / `create_folder` — Drive
- `copy_file` / `move_file` / `delete_file` — Drive file operations (copy, move, delete)
- `upload_image` / `upload_file` — Upload image/file, returns key for send_image/send_file
- `find_user` — Contact lookup by email/mobile
- `list_calendars` / `create_calendar_event` / `list_calendar_events` / `delete_calendar_event` — Calendar management
- `get_freebusy` — Check user availability
- `create_task` / `get_task` / `list_tasks` / `update_task` / `complete_task` — Task management

## Usage Patterns

### Messaging
- Send text as yourself → `send_to_user` or `send_to_group`
- Send image → `upload_image` → `send_image_as_user`
- Send file → `upload_file` → `send_file_as_user`
- Send rich content → `send_post_as_user` (formatted text with links, @mentions)
- Reply as user in thread → `send_as_user` with root_id
- Reply as bot → `reply_message` (official API)

### Reading
- Read any group chat history → `read_messages` with chat name or ID (auto-handles external groups via UAT fallback)
- Read P2P chat history → `search_contacts` → `create_p2p_chat` → `read_p2p_messages`
- Get chat details → `get_chat_info` (supports both oc_xxx and numeric ID)

### Bitable (Multi-dimensional Tables)
- Create a bitable from scratch → `create_bitable` → `create_bitable_table` → `create_bitable_field`
- Query data → `list_bitable_tables` → `list_bitable_fields` → `search_bitable_records`
- Single record CRUD → `create_bitable_record` / `update_bitable_record` / `delete_bitable_record`
- Bulk operations → `batch_create_bitable_records` / `batch_update_bitable_records` / `batch_delete_bitable_records` (max 500/call)
- Manage fields → `create_bitable_field` / `update_bitable_field` (requires type param) / `delete_bitable_field`

### Group Management
- Create a group → `create_group` with name and optional member open_ids
- Add/remove members → `add_members` / `remove_members` with chat_id + user open_ids
- List members → `list_members`

### Document Editing
- Create doc with content → `create_doc` → `create_doc_block` (use document_id as parent_block_id for root)
- Edit existing block → `get_doc_blocks` to find block_id → `update_doc_block`
- Delete blocks → `delete_doc_blocks` with start/end index range

### Calendar
- View schedule → `list_calendars` → `list_calendar_events`
- Create event → `create_calendar_event` with calendar_id, summary, start/end time
- Check availability → `get_freebusy` with user open_ids and time range

### Tasks
- Create task → `create_task` with summary, optional description/due
- Track tasks → `list_tasks` → `update_task` / `complete_task`

### Diagnostics
- Diagnose issues → `get_login_status` first

## Auth & Session
- **LARK_COOKIE**: Required for user identity tools. Session auto-refreshed every 4h via heartbeat and persisted to config.
- **LARK_APP_ID + LARK_APP_SECRET**: Required for official API tools.
- **LARK_USER_ACCESS_TOKEN + LARK_USER_REFRESH_TOKEN**: Required for P2P reading. Auto-refreshed on expiry (error codes 99991668/99991663/99991677). Token auto-persisted to MCP config on refresh.
- Cookie expiry: sl_session has 12h max-age, auto-refreshed by heartbeat every 4h.
- UAT expiry: 2h, auto-refreshed via refresh_token.
- Refresh token expiry: 7 days. Use `keepalive` cron to prevent expiration.

## Required Environment Variables (ALL are required for full functionality)

| Variable | Purpose |
|----------|---------|
| LARK_COOKIE | User identity messaging |
| LARK_APP_ID | Official API access |
| LARK_APP_SECRET | Official API access |
| LARK_USER_ACCESS_TOKEN | P2P chat reading |
| LARK_USER_REFRESH_TOKEN | UAT auto-refresh |

All 5 must be configured. Without UAT, `read_p2p_messages` and `list_user_chats` will not work.

## Installation

### Config location

Credentials are stored in `~/.claude.json` top-level `mcpServers` (global — works in all directories).
**Do NOT put credentials in project-level config** (`projects[*].mcpServers` or `.mcp.json`) — this causes scope issues.

### Non-interactive setup (for Claude Code agents)

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
```

Writes config to `~/.claude.json` top-level `mcpServers` without any interactive prompts. Supports `--cookie` flag too.

### Interactive setup

```bash
npx feishu-user-plugin setup    # Interactive setup wizard
npx feishu-user-plugin oauth    # Get OAuth UAT tokens
npx feishu-user-plugin status   # Check auth status
npx feishu-user-plugin keepalive # Refresh cookie + UAT (for cron jobs)
```

### Token auto-renewal via cron (optional)

To keep tokens alive even when Claude Code is closed:

```bash
crontab -e
# Add: 0 */4 * * * npx feishu-user-plugin keepalive >> /tmp/feishu-keepalive.log 2>&1
```

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

**Step 5: Write cookie to config**

Use `persistToConfig` or directly update the `LARK_COOKIE` field in `~/.claude.json` → `mcpServers` → `feishu-user-plugin` → `env`.

**Step 6: Run OAuth for UAT (if not already configured)**

```bash
npx feishu-user-plugin oauth
```

This opens a browser for OAuth consent. After completion, tokens are auto-saved to `~/.claude.json`.

**Step 7: Close browser and prompt restart**

```
browser_close
```

Tell user to restart Claude Code. Only ONE restart should be needed.

## Troubleshooting Guide

### If MCP tools are not available
1. Check `~/.claude.json` — config must be in **top-level** `mcpServers`, not inside `projects[*]`
2. Restart Claude Code after config changes
3. After restart, tools may take a few seconds to register — if first call fails with "No such tool", wait and retry once

### If cookie authentication fails
- `document.cookie` in browser console CANNOT access HttpOnly cookies (`session`, `sl_session`)
- **Correct method**: Network tab → first request → Request Headers → Cookie → Copy value
- **Best method**: Playwright two-step extraction (see above)

### If Playwright logs into the wrong Feishu account
- Playwright uses Edge's persistent profile with cached sessions
- **ALWAYS clear cookies first** with `context.clearCookies()` before navigating to feishu.cn

### If read_messages returns an error
- Error messages include the actual Feishu error code and description
- `read_messages` auto-falls back to UAT when bot API fails (e.g. external groups)
- Chat name resolution: bot's group list → `im.chat.search` → `search_contacts` (cookie)
- If all three strategies fail, provide the oc_xxx or numeric chat ID directly

### If UAT refresh fails with "invalid_grant"
- The refresh token has expired or been revoked — auto-refresh cannot recover this
- **Fix**: Re-run OAuth: `npx feishu-user-plugin oauth`
- Then restart Claude Code

### If OAuth fails with "Missing LARK_APP_ID"
- `oauth.js` reads credentials from `~/.claude.json` MCP config (not .env)
- Run `npx feishu-user-plugin setup` first, then re-run OAuth

### If two MCP servers are running (duplicate tools)
- This happens when both `~/.claude.json` mcpServers AND a team-skills plugin have feishu-user-plugin
- team-skills plugin should NOT have `.mcp.json` — it only provides skills and CLAUDE.md
- Delete `.mcp.json` from the team-skills plugin directory if it exists

### If list_user_chats doesn't return P2P chats
- This is expected — the API only returns group chats
- **Correct P2P flow**: `search_contacts` → `create_p2p_chat` → `read_p2p_messages`

## Architecture

### Two distribution channels
- **npm package** (`npx feishu-user-plugin`): MCP server code + skills + CLAUDE.md. For external users.
- **team-skills plugin**: Skills + CLAUDE.md only (no .mcp.json). For internal team members.

### Config management
- `src/config.js`: Unified config module. Discovers config in `~/.claude.json` (top-level + project-level) and `.mcp.json`.
- `setup` always writes to `~/.claude.json` top-level `mcpServers` (global).
- `persistToConfig()` finds the correct config entry and writes back (used by heartbeat + UAT refresh).

## Development & Publishing

### Publishing to npm

```bash
# 1. Update version in package.json
# 2. Commit and tag
git add -A && git commit -m "v1.2.1: description"
git tag v1.2.1
git push && git push --tags
# 3. GitHub Actions auto-publishes to npm on tag push
```

GitHub Actions workflow (`.github/workflows/publish.yml`) auto-publishes on `v*` tags.
NPM_TOKEN is stored as a GitHub repo secret.

### Syncing to team-skills

After publishing, sync plugin assets to team-skills:

```bash
# From the feishu-user-plugin repo:
cp -r skills/ /path/to/team-skills/plugins/feishu-user-plugin/skills/
cp .claude-plugin/plugin.json /path/to/team-skills/plugins/feishu-user-plugin/.claude-plugin/
# Do NOT copy .mcp.json — team-skills plugin should not have one
```

## Development Workflow

### Keeping all docs in sync
When making ANY code change (new tools, bug fixes, features), update ALL of these:
- `CLAUDE.md` — tool count, tool list, usage patterns, known limitations
- `ROADMAP.md` — check off completed items, add new findings
- `README.md` — tool count (badge + heading + list), feature highlights, config examples
- `skills/feishu-user-plugin/references/CLAUDE.md` — copy from root CLAUDE.md
- `package.json` — version, description (tool count)
- Sync to team-skills: `cp -r skills/ /Users/abble/team-skills/plugins/feishu-user-plugin/skills/`
- If prompts changed: also sync `prompts/` to team-skills

### Keeping ROADMAP.md up to date
- When completing a feature or fixing a bug, check the corresponding item in ROADMAP.md as `[x]` done
- When discovering new bugs, limitations, or feature ideas during development, add them to the appropriate section in ROADMAP.md
- When a version is released (tag pushed), move completed items under the "已完成" section with the version number
- When researching a direction and deciding not to implement, add it to "已调研但暂不实施" with the reasoning

### When adding new tools
1. Add method to `src/official.js`（Official API）or `src/client.js`（Cookie 身份）
2. Add tool definition to `TOOLS` array in `src/index.js`
3. Add handler case in `handleTool()` switch in `src/index.js`
4. Run `node -c src/official.js && node -c src/index.js` to verify syntax
5. Update this file (CLAUDE.md) — tool count, tool list, usage patterns
6. Update ROADMAP.md if relevant

### When fixing bugs
1. Write a standalone test script (`node -e "..."`) to reproduce the bug before fixing
2. After fixing, verify with the same script
3. If the bug affects MCP tool behavior, test via MCP tool call after server restart

### Commit conventions
- `feat:` new tools or capabilities
- `fix:` bug fixes
- `docs:` CLAUDE.md, ROADMAP.md, README updates
- `chore:` dependencies, CI, config changes

### Publishing
1. Update `version` in `package.json`
2. `git add <files> && git commit -m "v1.x.x: description"`
3. `git tag v1.x.x && git push && git push --tags`
4. GitHub Actions auto-publishes to npm. Users get the new version on next Claude Code restart.

### Syncing to team-skills (after any CLAUDE.md or skills change)
1. Copy CLAUDE.md to skill reference: `cp CLAUDE.md skills/feishu-user-plugin/references/CLAUDE.md`
2. Sync to team-skills repo: `cp -r skills/ /Users/abble/team-skills/plugins/feishu-user-plugin/skills/`
3. Also sync plugin.json: `cp .claude-plugin/plugin.json /Users/abble/team-skills/plugins/feishu-user-plugin/.claude-plugin/`
4. Commit and push both repos

### Testing a tool
- For Official API tools: can test directly via MCP tool call or standalone script using `readCredentials()` from `src/config.js`
- For Cookie tools: need active session, test via MCP tool call
- Always verify `_safeSDKCall` handles the response format (multipart uploads return data at top level, not nested under `.data`)

## Known Limitations
- CARD message type (type=14) not yet implemented — complex JSON schema
- External tenant users may not be resolvable via `get_user_info` (contact API scope limitation)
- Cookie auth requires human interaction (QR scan) — cannot be fully automated
- Refresh token expires after 7 days without use — set up `keepalive` cron to prevent this
- `update_bitable_field` requires `type` parameter even when only changing field name (Feishu API requirement)
- `list_wiki_spaces` may return empty if bot lacks `wiki:wiki:readonly` permission
- `search_wiki` uses same API as `search_docs` — `docs_types` filter may not work as expected
