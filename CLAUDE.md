# feishu-user-plugin — Claude Code Instructions

## What This Is
All-in-one Feishu plugin for Claude Code with three auth layers:
- **User Identity** (cookie auth): Send messages (text, image, file, post, sticker, audio) as yourself
- **Official API** (app credentials): Read group messages, docs, tables, wiki, drive, contacts, upload files
- **User OAuth UAT** (user_access_token): Read P2P chat history, list all user's chats

## Tool Categories (67 tools)

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
- `list_chats` / `read_messages` — Chat history (read_messages accepts chat name, oc_ ID, or numeric ID; auto-resolves via bot's group list → im.chat.search → search_contacts). **Auto-falls back to UAT for external groups the bot cannot access.** Returns newest messages first by default. Messages include sender names.
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
- `list_wiki_spaces` / `search_wiki` / `list_wiki_nodes` — Wiki
- `list_files` / `create_folder` — Drive
- `copy_file` / `move_file` / `delete_file` — Drive file operations (copy, move, delete)
- `upload_image` / `upload_file` — Upload image/file, returns key for send_image/send_file
- `download_image` — Download an image from a message (needs message_id + image_key from read_messages) and return it as MCP image content so the model can **see the pixels**, not just the key. Tries UAT first, falls back to app token (app path requires the bot to be in the chat).
- `find_user` — Contact lookup by email/mobile

## Usage Patterns

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

## Known Limitations
- CARD message type (type=14) not yet implemented — complex JSON schema
- External tenant users may not be resolvable via `get_user_info` (contact API scope limitation)
- Cookie auth requires human interaction (QR scan) — cannot be fully automated
- Refresh token expires after 7 days without use — set up `keepalive` cron to prevent this
- `update_bitable_field` requires `type` parameter even when only changing field name (Feishu API requirement)
- `list_wiki_spaces` may return empty if bot lacks `wiki:wiki:readonly` permission
- `search_wiki` uses same API as `search_docs` — `docs_types` filter may not work as expected
