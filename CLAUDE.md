# feishu-user-plugin — Claude Code Instructions

## What This Is
All-in-one Feishu plugin for Claude Code with three auth layers:
- **User Identity** (cookie auth): Send messages (text, image, file, post, sticker, audio) as yourself
- **Official API** (app credentials): Read group messages, docs, tables, wiki, drive, contacts, upload files
- **User OAuth UAT** (user_access_token): Read P2P chat history, list all user's chats

## Tool Categories (75 tools)

### User Identity — Messaging (reverse-engineered, cookie-based)
- `send_to_user` — Search user + send text (one step, most common). Returns candidates if multiple matches.
- `send_to_group` — Search group + send text (one step). Returns candidates if multiple matches.
- `send_as_user` — Send text to any chat by ID, supports reply threading (root_id/parent_id)
- `send_image_as_user` — Send image (requires image_key from `upload_image`)
- `send_file_as_user` — Send file (requires file_key from `upload_file`)
- `send_post_as_user` — Send rich text with title + formatted paragraphs. Elements: `{tag:"text"}`, `{tag:"a",href,text}`, `{tag:"at",userId,name}`. **@-mentions trigger real notifications** (fixed by registering AT element IDs in RichText.atIds field 6 — reverse-engineered from Feishu Web bundle's AtProperty + RichText schemas).
- `send_as_user` / `send_to_user` / `send_to_group` — plain text sends now accept optional `ats: [{userId, name}]`; the text must contain the `@<name>` marker for each entry. The marker is spliced into a real AT element so the mentioned user is notified. Identity is the cookie user (not bot).
- `send_sticker_as_user` — Send sticker/emoji
- `send_audio_as_user` — Send audio message

### User Identity — Contacts & Info
- `search_contacts` — Search users/groups by name
- `create_p2p_chat` — Create/get P2P chat
- `get_chat_info` — Group details (name, members, owner). Supports both oc_xxx and numeric chat_id (Official API + protobuf fallback)
- `get_user_info` — User display name lookup (official API first, cookie cache fallback)
- `get_login_status` — Check cookie, app, and UAT status

### User OAuth UAT Tools (P2P chat reading + user-identity creation)
- `read_p2p_messages` — Read P2P (direct message) chat history. chat_id accepts both numeric IDs (from create_p2p_chat) and oc_xxx format. Returns newest messages first by default.
- `list_user_chats` — List group chats the user is in. Note: API only returns groups, not P2P. For P2P, use: `search_contacts` → `create_p2p_chat` → `read_p2p_messages`.
- **All docx + bitable + drive create/read/write tools are UAT-first**: when UAT is configured, every operation (create/edit/delete doc blocks, bitable tables/fields/views/records, drive folders) tries the user's token first and falls back to app token on failure. This keeps resources consistently owned by the user and avoids 403 errors when the app can't access user-created resources. Read-only tools (e.g. `read_doc`, `get_doc_blocks`, `list_bitable_tables`) are also UAT-first so user-owned resources remain readable.

### Official API Tools (app credentials)
- `list_chats` / `read_messages` — Chat history (read_messages accepts chat name, oc_ ID, or numeric ID; auto-resolves via bot's group list → im.chat.search → search_contacts). **Auto-falls back to UAT for external groups the bot cannot access.** Returns newest messages first by default. Messages include sender names. **v1.3.5**: `merge_forward` messages now auto-expand into their child messages (2 images + 4 texts, with original sender / time / origin chat preserved); text messages get `urls[]` + `feishuDocs[]` extracted so agents can feed them straight into `read_doc` / WebFetch. Disable expansion with `expand_merge_forward=false`.
- `send_message_as_bot` — Bot sends message to any chat (text, post, interactive, etc.)
- `reply_message` / `forward_message` — Message operations (as bot)
- `delete_message` / `update_message` — Recall or edit bot's own messages
- `add_reaction` / `delete_reaction` — Emoji reactions on messages
- `pin_message` — Pin or unpin a message (pinned=true/false)
- `create_group` / `update_group` — Create and manage group chats
- `list_members` / `manage_members` — Group membership (manage_members: action=add/remove)
- `search_docs` / `read_doc` / `get_doc_blocks` / `create_doc` — Document operations
- `create_doc_block` / `update_doc_block` / `delete_doc_blocks` — Document content editing (insert/update/delete blocks)
- `create_bitable` / `get_bitable_meta` / `copy_bitable` — Bitable app management (create, get info, copy)
- `list_bitable_tables` / `create_bitable_table` / `update_bitable_table` / `delete_bitable_table` — Table management (CRUD + rename)
- `list_bitable_fields` / `create_bitable_field` / `update_bitable_field` / `delete_bitable_field` — Field (column) management
- `list_bitable_views` / `create_bitable_view` / `delete_bitable_view` — View management (grid, kanban, gallery, form, gantt, calendar)
- `search_bitable_records` / `get_bitable_record` — Query records
- `batch_create_bitable_records` / `batch_update_bitable_records` / `batch_delete_bitable_records` — Record CRUD (single or batch, max 500/call)
- `list_wiki_spaces` / `search_wiki` / `list_wiki_nodes` / `get_wiki_node` — Wiki (v1.3.4 adds `get_wiki_node` which resolves a wiki node token to its underlying `obj_type` + `obj_token`, so you can feed the node straight into `read_doc`, bitable tools, etc.)
- `list_files` / `create_folder` — Drive
- `copy_file` / `move_file` / `delete_file` — Drive file operations (copy, move, delete)
- `upload_image` / `upload_file` — Upload image/file, returns key for send_image/send_file
- `download_image` — Download an image and return it as MCP image content so the model **sees the pixels**. Two modes: (1) **message image** — pass `message_id` + `image_key` from read_messages. (2) **docx image** — pass `image_token` (from `get_doc_blocks` image block) and optionally `doc_token` (native id / wiki node / Feishu URL). Tries UAT first, falls back to app token. **merge_forward children**: use the child's `parentMessageId` (NOT the child id) — Feishu returns `File not in msg` with the child id.
- `download_file` — Download a file (msg_type=file) attachment. Returns base64 + mimeType + byte count; optional `save_path` writes the file to disk. Same parent-id rule for merge_forward children as download_image.
- `list_user_okrs` / `get_okrs` / `list_okr_periods` — OKR read. UAT-first (works for the authenticated user's OKRs) with app fallback when OKR scope is granted.
- `list_calendars` / `list_calendar_events` / `get_calendar_event` — Calendar read. UAT-first (primary + shared + subscribed); app identity only sees calendars the bot was explicitly invited to.
- `find_user` — Contact lookup by email/mobile

## Usage Patterns

### Wiki-hosted content (docx / bitable / sheet)
All docx and bitable tools now accept three input forms for their `document_id` / `app_token` parameter:
- Native token (unchanged): `doccnXXX`, `docxXXX`, `bascnXXX`, ...
- Wiki node token: `wikcnXXX`, `wikmXXX`, `wiknXXX`
- Full Feishu URL: `https://xxx.feishu.cn/docx/XXX`, `.../wiki/XXX`, `.../base/XXX`
The plugin resolves wiki nodes to their underlying `obj_token` via `getWikiNode`, then calls the normal docx / bitable endpoint. Results are cached for 10 min to avoid repeated node lookups.

Create content directly into a Wiki space:
- `create_doc` / `create_bitable` accept optional `wiki_space_id` (+ `wiki_parent_node_token`). The plugin creates the resource in drive, then calls `wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki` to attach it — returns `wikiNodeToken` on immediate success, or `wikiAttachTaskId` if Feishu queues the move.

### Document images
Read — `download_image` with `doc_token` + `image_token` returns the image as MCP image content (base64 + mimeType). `doc_token` accepts native id / wiki node / URL.
Write — `create_doc_block` now has image shortcuts:
- `image_path` (absolute local file path) → plugin creates an image block, uploads the pixels via `drive/v1/medias/upload_all`, and patches the block with the uploaded token.
- `image_token` (already uploaded) → plugin creates block and attaches token.
`update_doc_block` accepts `image_token` to swap the picture in an existing image block.

### OKR
1. `list_okr_periods` — find the period id for current quarter.
2. `list_user_okrs(user_id=<open_id>, period_ids=[...])` — list the target user's OKRs.
3. `get_okrs(okr_ids)` — batch fetch full objective + key result structure with progress + alignments.
`user_id` is required — use your own open_id (from `get_login_status` / `search_contacts`) to read your own OKRs, or a colleague's open_id for theirs (subject to permissions).

### Calendar
1. `list_calendars` — get your calendars; the one with `type=primary` is your personal calendar.
2. `list_calendar_events(calendar_id, start_time=<unix_sec>, end_time=<unix_sec>)` — list events in a time window.
3. `get_calendar_event(calendar_id, event_id)` — full details (attendees, location, attachments, meeting link).

### External-group message read (hardened in v1.3.4)
`read_messages` and `read_p2p_messages` now expose a `via` field in the response (`"bot"`, `"user"`, or `"contacts"`) so callers can tell which identity actually read the data. When bot fails with a known code (external tenant / no permission / not in chat) the plugin hops straight to UAT; transient errors (rate limit / 5xx / ECONNRESET / fetch timeout) retry once with a 2 s delay before falling back. When UAT isn't configured, the error message now tells the user to run `npx feishu-user-plugin oauth` instead of leaking the raw Feishu payload.

### Messaging
- Send text as yourself → `send_to_user` or `send_to_group`
- Send image → `upload_image` → `send_image_as_user`
- Send file → `upload_file` → `send_file_as_user`
- Send rich content → `send_post_as_user` (formatted text + links + real @-mentions via `{tag:"at",userId,name}`)
- Send text with @-mentions (plain text) → `send_as_user` / `send_to_user` / `send_to_group` with `ats:[{userId,name}]` + text containing `@<name>` markers
- Bot-identity @-mention alternative → `send_message_as_bot` with `<at user_id="ou_xxx">Name</at>` inline in content text
- Reply as user in thread → `send_as_user` with root_id
- Reply as bot → `reply_message` (official API)

### Reading
- Read any group chat history → `read_messages` with chat name or ID (auto-handles external groups via UAT fallback)
- Read P2P chat history → `search_contacts` → `create_p2p_chat` → `read_p2p_messages`
- Get chat details → `get_chat_info` (supports both oc_xxx and numeric ID)

### Bitable (Multi-dimensional Tables)
- Create a bitable from scratch → `create_bitable` → `create_bitable_table` → `create_bitable_field`
- Get bitable info → `get_bitable_meta`
- Copy a bitable → `copy_bitable` with name and optional folder
- Query data → `list_bitable_tables` → `list_bitable_fields` → `search_bitable_records`
- Rename table → `update_bitable_table` with new name
- Read single record → `get_bitable_record`
- Create/update/delete records → `batch_create_bitable_records` / `batch_update_bitable_records` / `batch_delete_bitable_records` (works for single or up to 500)
- Manage fields → `create_bitable_field` / `update_bitable_field` (requires type param) / `delete_bitable_field`
- Manage views → `create_bitable_view` (type: grid/kanban/gallery/form/gantt/calendar) / `delete_bitable_view`

### Group Management
- Create a group → `create_group` with name and optional member open_ids
- Add/remove members → `manage_members` with chat_id + member_ids + action (add/remove)
- List members → `list_members`

### Document Editing
- Create doc with content → `create_doc` → `create_doc_block` (use document_id as parent_block_id for root)
- Edit existing block → `get_doc_blocks` to find block_id → `update_doc_block`
- Delete blocks → `delete_doc_blocks` with start/end index range

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

### If MCP disconnects mid-session
Two known root causes, both fixed in v1.3.3:

1. **stdout pollution** (partial fix in v1.3.1, fully closed in v1.3.3):
   - `@larksuiteoapi/node-sdk`'s `defaultLogger.error` uses `console.log` (stdout). MCP uses stdout for JSON-RPC, so any stray write corrupts the transport and disconnects the client.
   - v1.3.1 replaced the SDK's logger. v1.3.3 also globally redirects `console.log` / `console.info` → `console.error` at the top of `src/index.js` as defense-in-depth against ANY future dependency leaking to stdout.

2. **unbounded fetch hangs** (fixed in v1.3.3):
   - All raw `fetch` calls to `feishu.cn` / `internal-api-lark-api.feishu.cn` used to have no timeout. A stalled connection (ECONNRESET, slow DNS, upstream hang) would block a tool handler indefinitely; the MCP client times out the request, which some clients handle by tearing down the stdio transport — observed as "mid-session disconnect".
   - Fix: `utils.js::fetchWithTimeout` with `AbortController`, 30s default. All `client.js` + `official.js` fetches go through it.
   - If still happening: check for any `console.log` calls in server code (only `console.error` is safe), and grep for raw `await fetch(` — every one must go through `fetchWithTimeout`.

### If Official API tools return 401 / "token invalid" every time
- **Likely cause**: `LARK_APP_ID` is wrong or stale. Observed in production: Claude Code auto-installed the plugin and guessed/copied a wrong APP_ID that doesn't match the team's real app (e.g. from an unrelated app, from someone else's machine, or hallucinated).
- **Diagnosis**: `get_login_status` now reports `App credentials: INVALID — app_id=<x> rejected by Feishu (<code>: <msg>)`. MCP startup logs `[feishu-user-plugin] ERROR: LARK_APP_ID=<x> was REJECTED by Feishu` on stderr when this happens.
- **Fix**: Re-run the canonical install prompt from `team-skills/plugins/feishu-user-plugin/README.md` which contains the correct APP_ID/SECRET, and restart Claude Code.

### If MCP tools are not available
1. Check `~/.claude.json` — config must be in **top-level** `mcpServers`, not inside `projects[*]`
2. For Codex: check `~/.codex/config.toml` has `[mcp_servers.feishu-user-plugin]` section
3. Restart Claude Code / Codex after config changes
4. After restart, tools may take a few seconds to register — if first call fails with "No such tool", wait and retry once

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
- Then restart Claude Code / Codex so running MCP server processes load the new token
- **v1.3.5+ hardening** (no manual action required, fixes the common case):
  - Cross-process file lock at `~/.claude/feishu-uat-refresh.lock` (`O_CREAT|O_EXCL`, 30 s stale detection) — at most one MCP process refreshes at a time.
  - Inside the critical section the lock holder re-reads `~/.claude.json` to see if a peer already rotated the token; if so, it adopts the fresh token instead of consuming an already-invalidated refresh token.
  - This closes the "Codex spawned 6 MCP servers, all shared the same refresh_token, all raced to refresh" failure mode observed on 2026-04-23.
  - `get_login_status` now does a real UAT health check (calls `listChatsAsUser({pageSize:1})`) — no more "token configured but actually 401" surprises.

### If multiple MCP server processes keep spawning
- Observed on Codex + Claude Code when the client respawns the server for each tool session without cleaning up the previous one. 6 concurrent `src/index.js` processes is not unusual under heavy use.
- v1.3.5 neutralises the damage (UAT refresh serialised via file lock) but the stale processes still consume memory.
- **Manual cleanup when you notice**: `pkill -f 'feishu-user-plugin/src/index.js'` — the client will respawn one fresh process on the next tool call.

### If a create_* tool warns "UAT failed, created as BOT"
- v1.3.5 added an explicit `⚠️` warning to MCP responses whenever `_asUserOrApp` silently fell back to bot identity for a write (create_doc / create_bitable / create_folder / create_doc_block / ...). Before v1.3.5 this was silent and led to the "teammate can read my 'private' doc" issue.
- **Cause**: your UAT is failing (expired / scope missing / race) so the plugin reached for bot credentials. The resulting resource is owned by the shared bot, tenant-readable by default, NOT by you.
- **Fix**: run `npx feishu-user-plugin oauth` and restart Claude Code / Codex. If the resource needs to be yours, delete the bot-owned copy and recreate after UAT is valid.

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
- `src/config.js`: Unified config module. Discovers config in `~/.claude.json` (top-level + project-level), `.mcp.json`, and `~/.codex/config.toml`.
- `setup` writes to `~/.claude.json` (default) or `~/.codex/config.toml` (with `--client codex`), or both (`--client both`).
- `persistToConfig()` finds the correct config entry and writes back atomically (used by heartbeat + UAT refresh).
- All config writes use atomic write (tmp file + rename) to prevent race conditions with Claude Code.

### Multi-client support
- **Claude Code**: JSON config in `~/.claude.json` mcpServers
- **Codex**: TOML config in `~/.codex/config.toml` mcp_servers
- Setup: `npx feishu-user-plugin setup --client codex` or `--client both`
- MCP server code is identical for both clients — only config format differs
- Codex does not support Claude Code slash commands (skills) — only MCP tools are available

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

**IMPORTANT: team-skills 仓库禁止直接推送 main。所有变更必须走 PR。**

team-skills 推送规范:
1. **创建 feature branch**: `git checkout -b fix/feishu-xxx` 或 `sync/feishu-v1.x.x`
2. **提交变更并推送 branch**: `git push -u origin <branch-name>`
3. **创建 PR 并设置 auto-merge**: `gh pr create --title "..." --body "..."` 然后 `gh pr merge <number> --auto --merge`
4. **CI 通过后自动合并**: validate workflow 检查三方版本一致性,通过即自动 merge,无需手动操作
5. **如 CI 失败**: 修复后 push 到同一 branch,CI 会重跑,通过后自动合并

三方版本一致性规则:
- `plugins/feishu-user-plugin/.claude-plugin/plugin.json` 的 `version`
- `plugins/feishu-user-plugin/skills/feishu-user-plugin/SKILL.md` frontmatter 的 `version`
- `plugins/feishu-user-plugin/README.md` 更新日志里第一个 `### vX.Y.Z` 标题
- 这三个版本号必须相同,否则 CI 会失败。每次 npm 发包后,team-skills 的版本号也要同步更新。

同步内容（每次发版后执行）:
```bash
# 1. 同步 skills + plugin.json
cp CLAUDE.md skills/feishu-user-plugin/references/CLAUDE.md
cp -r skills/ /Users/abble/team-skills/plugins/feishu-user-plugin/skills/
cp .claude-plugin/plugin.json /Users/abble/team-skills/plugins/feishu-user-plugin/.claude-plugin/
# 2. 手动更新 team-skills 的 README.md（工具数、更新日志）和 SKILL.md（version + allowed-tools）
# 3. 走 PR 流程推送
# Do NOT copy .mcp.json — team-skills plugin should not have one
```

## Development Workflow

### Keeping all docs in sync
When making ANY code change (new tools, bug fixes, features), update ALL of these:

**本仓库内：**
- `CLAUDE.md` — tool count, tool list, usage patterns, known limitations
- `AGENTS.md` — **每次改 CLAUDE.md 必须同步**：正文（第 2 行起）与 CLAUDE.md 完全一致，仅首行标题保留 `# feishu-user-plugin — Codex Instructions`。同步命令：`tail -n +2 CLAUDE.md > /tmp/body.md && { echo "# feishu-user-plugin — Codex Instructions"; cat /tmp/body.md; } > AGENTS.md`
- `README.md` — tool count (badge + heading + tool table), feature highlights, OpenClaw/Claude Code config examples
- `ROADMAP.md` — check off completed items, add new findings
- `package.json` — version, description (tool count)
- `skills/feishu-user-plugin/references/CLAUDE.md` — always copy from root: `cp CLAUDE.md skills/feishu-user-plugin/references/CLAUDE.md`
- `prompts/openclaw-setup.md` — if OpenClaw 相关配置变了要更新

**team-skills 仓库 (`/Users/abble/team-skills/plugins/feishu-user-plugin/`)：**
- `skills/` — 同步技能文件: `cp -r skills/ /Users/abble/team-skills/plugins/feishu-user-plugin/skills/`
- `README.md` — team-skills 有自己的 README（含团队 APP_ID/SECRET），需要同步更新：工具数量、功能列表、更新日志、安装 prompt
- 两个 README 都必须包含 Claude Code 安装 prompt 和 OpenClaw 安装 prompt
- team-skills README 的安装 prompt 包含团队共享的 APP_ID/SECRET（hardcoded），本仓库 README 用占位符

**同步命令（每次发版后执行）：**
```bash
# 1. 同步 skills + plugin.json
cp CLAUDE.md skills/feishu-user-plugin/references/CLAUDE.md
cp -r skills/ /Users/abble/team-skills/plugins/feishu-user-plugin/skills/
cp .claude-plugin/plugin.json /Users/abble/team-skills/plugins/feishu-user-plugin/.claude-plugin/
# 2. 手动更新 team-skills README（工具数、功能列表、更新日志）+ SKILL.md（version + allowed-tools）
# 3. 走 PR 流程推送 team-skills（禁止直接推 main）
```

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
**IMPORTANT: Version number must ALWAYS be confirmed with the user before publishing.**
Any operation involving `npm version`, modifying `package.json` version, `git tag v*`, or `git push --tags` requires explicit user confirmation of the target version number. Do not auto-decide version numbers.

Three-layer version safety:
1. **Claude rule** (this section): Ask user to confirm version before any publish-related operation
2. **Local gate** (`prepublishOnly`): Interactive confirmation when running `npm publish` locally (skipped in CI)
3. **CI gate** (`.github/workflows/publish.yml`): Tag must match `package.json` version or publish fails

Steps:
1. Confirm target version with user
2. Update `version` in `package.json`
3. `git add <files> && git commit -m "v1.x.x: description"`
4. `git tag v1.x.x && git push && git push --tags`
5. GitHub Actions verifies tag matches package.json, then auto-publishes to npm
6. **After npm confirms the new version is live, draft a release announcement in Chinese for the "AI技术解决（内部）" Feishu group and show it to the user for approval BEFORE sending.** Do not send until the user explicitly approves.

### Release announcement rules (every release)
After a successful publish, draft a group announcement to "AI技术解决（内部）" (chat_id `7599552782038813643`) and ALWAYS show it to the user for review first. Only send after explicit approval.

**Transport**: `send_post_as_user` (rich-text post). No @-mentions — announcements are impersonal broadcasts. No emojis. No marketing language.

**Structure** (in this order; omit a section if it doesn't apply this release):

```
feishu-user-plugin vX.Y.Z 发布

<一到两句开篇总结本次发布的主题，陈述语气，不推销>

修复
• <缺陷描述>：<根因与修复机制，引用具体错误码/接口名/参数>
• ...

新增
• 新增 <tool 名> 工具：<一句话功能描述>。<关键约束或调用条件>
• ...

调整
• <行为变化的描述>
• ...

下版本计划
• <条目>
• ...

升级方式
• 重启 Claude Code / Codex 即可自动拉取 X.Y.Z
• <若有相关新日志/错误提示，说明怎么应对>
• 建议复测 N 个场景：<场景 1>、<场景 2>、<场景 3>
```

**写作规范**:
- **开篇**：一到两句陈述式总结，不宣传、不夸大。参考 v1.3.2："本次更新主要补齐了 X 能力，并修复了 Y 问题；同时将 Z 统一调整为 ..."
- **每条 bullet**：先写用户可见现象，再写底层机制。引用具体错误码（如 1770032 / 91403）、接口名（如 create_doc_block）、参数名（如 RichText.atIds）——专业读者信赖的是细节
- **字符**：bullet 用 `•`（U+2022），不用 `-` 或 `*`；代码/工具名在正文中直接写，不加反引号
- **禁用**：emoji、🔴🟡🟢 之类严重度标记、`@` 任何人、营销词（"强大"、"全新"、"重磅"）、夸张修辞
- **语气**：技术 release note 的中性语气，像写给同行的内部更新。参考 v1.3.2 全文
- **长度**：单屏为宜，一般 400–700 汉字。每条 bullet 一到三行
- **下版本计划**：复制自上一版公告仍未完成的条目 + 本次发布中暴露的新方向。本版已完成的条目必须删除
- **升级方式**：至少包含重启指令；若本次修了某类错误（如 APP_ID 校验），列出对应诊断日志字样；以"建议复测 N 个场景"收尾，场景要具体可操作

**结尾**：不加 CHANGELOG 链接（v1.3.2 风格未含链接，群内读者不需要）。

**发送前**：始终先用 `send_to_user` 或类似工具发给用户自己审核，或直接以文本形式贴在对话里等用户批准。用户说"发"才调 `send_post_as_user` 到目标群。

### Syncing to team-skills (after any CLAUDE.md or skills change)
1. Copy CLAUDE.md to skill reference: `cp CLAUDE.md skills/feishu-user-plugin/references/CLAUDE.md`
2. Sync to team-skills repo: `cp -r skills/ /Users/abble/team-skills/plugins/feishu-user-plugin/skills/`
3. Also sync plugin.json: `cp .claude-plugin/plugin.json /Users/abble/team-skills/plugins/feishu-user-plugin/.claude-plugin/`
4. Update SKILL.md version + allowed-tools, README.md changelog + tool count
5. **走 PR 流程**（创建 branch → push → PR → 等 CI 通过 → merge），禁止直接推 main

### Testing a tool
- For Official API tools: can test directly via MCP tool call or standalone script using `readCredentials()` from `src/config.js`
- For Cookie tools: need active session, test via MCP tool call
- Always verify `_safeSDKCall` handles the response format (multipart uploads return data at top level, not nested under `.data`)

## OAuth Scopes (when re-running `npx feishu-user-plugin oauth`)

The v1.3.4 tools require additional scopes on the app + UAT:

| Feature | Scopes to enable on app + include in OAuth |
|---------|-------------------------------------------|
| OKR read | `okr:okr:readonly`, `okr:period:read` |
| Calendar read | `calendar:calendar:readonly`, `calendar:calendar.event:read` |
| Docx image write (`uploadDocMedia`) | `drive:drive`, `docx:document`, `docx:document:readonly` (image upload piggy-backs on existing docx editing scopes) |
| Wiki attach (`move_docs_to_wiki`) | `wiki:wiki` (edit scope, the readonly one is insufficient) |

If a tool returns `access_denied` or error code `99991672` (scope not granted), enable the missing scope at https://open.feishu.cn/app → Permissions, then re-run `npx feishu-user-plugin oauth` so the UAT picks up the new scopes.

## Known Limitations
- CARD message type (type=14) not yet implemented — complex JSON schema
- External tenant users may not be resolvable via `get_user_info` (contact API scope limitation)
- Cookie auth requires human interaction (QR scan) — cannot be fully automated
- Refresh token expires after 7 days without use — set up `keepalive` cron to prevent this
- `update_bitable_field` requires `type` parameter even when only changing field name (Feishu API requirement)
- `list_wiki_spaces` may return empty if bot lacks `wiki:wiki:readonly` permission
- `search_wiki` uses same API as `search_docs` — `docs_types` filter may not work as expected
