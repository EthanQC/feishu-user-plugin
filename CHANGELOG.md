# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.3] - 2026-04-20

### Fixed
- **MCP mid-session disconnect (root fix)**: All raw `fetch` calls to Feishu now go through `fetchWithTimeout` (AbortController, 30s default). A stalled connection used to hang a tool handler indefinitely; the MCP client would time out and some clients tore down the stdio transport — observed as "MCP 中途掉线" on v1.3.2. This was the real cause, not just the v1.3.1 stdout pollution.
- **stdout pollution (defense-in-depth)**: `src/index.js` now globally redirects `console.log` / `console.info` to stderr at startup, before any other `require`. Any current or future dependency that accidentally writes to stdout can no longer corrupt the JSON-RPC channel. (v1.3.1's Lark-SDK-specific logger override stays as-is.)
- **`(as user)` label lied for docs/bitable/folder creation**: `create_doc` / `create_bitable` / `create_folder` previously labeled every successful call `(as user)` whenever `LARK_USER_ACCESS_TOKEN` was set, even when the UAT call actually failed and silently fell back to app identity. `_asUserOrApp` now threads a real `_viaUser` flag through; failures show `(as app — UAT unavailable or failed; <resource> owned by the app, not you)`.

### Added
- **APP_ID startup validation**: MCP server probes `/auth/v3/app_access_token/internal` at boot. Invalid `LARK_APP_ID` / `LARK_APP_SECRET` (wrong-tenant, stale, or hallucinated by an autoinstall) now produce a clear stderr error pointing at the team-skills install prompt. Non-blocking — users running cookie-only workflows are unaffected.
- **`get_login_status` shows app identity**: Now returns the actual `app_id` plus fetched app name, so users can immediately spot "this isn't my team's app" scenarios.
- **`download_image` tool**: Download an image embedded in a message by `message_id` + `image_key`, returned as MCP image content so the model can see the pixels (not just the key string). Tries UAT first (works for any chat the user is in); falls back to app token (requires the bot to be in the chat).

### Changed
- Tool count 66 → **67** (added `download_image`).
- README tool badge corrected from 76 → 67 (previous 76 was stale and never matched the actual export).

## [1.1.3] - 2026-03-11

### Fixed
- **Case-insensitive chat name matching**: All name resolution strategies (bot group list, im.chat.search, search_contacts) now use case-insensitive matching. "ai技术解决" now correctly matches "AI技术解决（内部）".
- **expires_in NaN bug**: UAT token refresh and OAuth now validate `expires_in` field, defaulting to 7200s if missing/invalid, preventing NaN corruption in config.
- **_populateSenderNames inefficiency**: Fixed redundant condition in cookie-based name fallback.
- **OAuth silent persistence failure**: Now logs warnings when token persistence to `~/.claude.json` fails, instead of silently swallowing errors.
- **Null safety**: Added null check in `resolveToOcId` for undefined chat_id.

## [1.1.2] - 2026-03-11

### Fixed
- **Double OAuth on first install**: `oauth.js` now writes tokens to both `.env` and `~/.claude.json` MCP config directly, so MCP restart picks them up immediately without needing a second OAuth run.
- **readMessagesAsUser fails with start_time but no end_time**: Auto-sets `end_time` to current timestamp when `start_time` is provided but `end_time` is not, preventing "end_time earlier than start_time" error.
- **read_p2p_messages rejects chat names**: Now resolves user/group names automatically via search_contacts.
- **External group messages show sender IDs instead of names**: `_populateSenderNames` now falls back to cookie-based user identity lookup for external tenant users.

## [1.1.1] - 2026-03-11

### Fixed
- **read_messages can't read external groups**: `read_messages` now auto-falls back to UAT when bot API fails (e.g. bot not in group, external groups). No need to manually switch to `read_p2p_messages`.
- **Chat name resolution for external groups**: Added Strategy 3 using `search_contacts` (cookie-based) to find groups not visible to bot or `im.chat.search`.
- **Numeric chat IDs not accepted by read_messages**: `resolveToOcId` now passes through numeric IDs directly.

## [1.1.0] - 2026-03-11

### Fixed
- **read_messages 400 error hidden**: Now shows actual Feishu error code and description instead of just "Request failed with status code 400"
- **Messages returned oldest first**: Default sort is now `ByCreateTimeDesc` (newest messages first) for both `read_messages` and `read_p2p_messages`
- **Chat name resolution**: Added `im.v1.chat.search` API as fallback when bot's group list doesn't contain the target chat
- **get_user_info fails for external users**: Added official contact API fallback (`contact.user.get`) for cross-tenant user lookup
- **Messages lack sender names**: `read_messages` and `read_p2p_messages` now auto-resolve sender IDs to display names
- **UAT persistence writes to npx temp dir**: Now persists refreshed tokens to `~/.claude.json` MCP config instead
- **oauth-auto.js missing offline_access scope**: Added `offline_access` to SCOPES (was missing, causing no refresh_token)
- **README "8 slash commands"**: Corrected to "9 slash commands" (was missing /drive)
- **CLAUDE.md false "type: stdio" warning**: Removed — `"type": "stdio"` is standard and harmless in Claude Code

### Added
- `sort_type` parameter for `read_messages` and `read_p2p_messages` (`ByCreateTimeDesc` / `ByCreateTimeAsc`)
- `senderName` field in message results (auto-resolved from sender ID)
- CLI subcommands: `npx feishu-user-plugin setup` (wizard), `oauth`, `status`
- `src/cli.js` — CLI dispatcher for subcommands
- `src/setup.js` — Interactive setup wizard (writes MCP config, validates credentials)
- `chatSearch()` method in official client (uses `im.v1.chat.search`)
- `getUserById()` method with caching for user name resolution
- `_safeSDKCall()` wrapper that extracts real Feishu errors from Lark SDK AxiosErrors
- `_populateSenderNames()` for batch sender name resolution in message lists

### Changed
- `package.json` bin entry points to `src/cli.js` (supports subcommands, default still starts MCP server)
- team-skills README rewritten for pure npm flow (no clone needed)
- CLAUDE.md OAuth instructions updated to use `npx feishu-user-plugin oauth`
- Error messages across all 33 tools now include actual Feishu error codes

## [1.0.2] - 2026-03-10

### Fixed
- `list_user_chats` description incorrectly claimed "including P2P" — actually only returns groups
- OAuth scope `contact:user.id:readonly` → `contact:user.base:readonly` in README
- Cookie length validation range (500-5000, was 1000-5000)
- Version inconsistency across `server.json`, `plugin.json`, `SKILL.md`, `src/index.js`
- Skill count: 8 → 9 (was missing `/drive`)
- README_CN.md Claude Desktop config missing `env` block

### Added
- Startup auth diagnostics in `src/index.js` (Cookie/App/UAT status logging)
- `LARK_USER_REFRESH_TOKEN` to all MCP config examples
- Troubleshooting for `invalid_grant` errors (28003/20003/20005)
- Troubleshooting for `oauth.js` requiring APP_ID/SECRET in `.env`
- Playwright cookie setup: two-step extraction, `clearCookies()`, ASCII validation
- `LARK_USER_REFRESH_TOKEN` to `server.json` environment_variables

### Changed
- All 5 env vars marked as required for full functionality
- Improved `read_p2p_messages` chat_id description (numeric + oc_xxx both accepted)

## [1.0.0] - 2026-03-09

### Changed
- Renamed from `feishu-user-mcp` to `feishu-user-plugin`
- Converted to Claude Code Plugin standard structure (`.claude-plugin/`, `skills/`)
- Skills moved from `.claude/commands/` to `skills/feishu-user-plugin/references/`
- MCP server config template added (`.mcp.json`)
- All client configurations now use `npx -y feishu-user-plugin`
- Version reset to 1.0.0

### Added
- `.claude-plugin/plugin.json` — Plugin metadata
- `skills/feishu-user-plugin/SKILL.md` — Main skill definition with allowed-tools
- `skills/feishu-user-plugin/references/CLAUDE.md` — Troubleshooting guide

### Fixed
- Version number consistency across `package.json`, `src/index.js`, and `server.json`

## [0.5.1] - 2026-03-08

### Fixed
- `search_docs` — SDK method `docx.builtin.search` does not exist; switched to `client.request()` with `/open-apis/suite/docs-api/search/object`
- `search_wiki` — SDK method `wiki.node.search` does not exist; switched to suite docs search API
- Message timestamp parsing — Feishu returns millisecond strings; added `_normalizeTimestamp()` to convert to seconds

### Changed
- Updated README to reflect all 33 tools with full documentation
- Updated `server.json` manifest with complete tool list
- Updated `.env.example` with UAT fields

### Added
- `src/test-all.js` — comprehensive test suite for all tools

## [0.5.0] - 2026-03-06

### Added
- P2P (direct message) chat reading via `read_p2p_messages`
- OAuth v2 authorization flow (`src/oauth.js`, `src/oauth-auto.js`)
- `list_user_chats` — list all chats the user is in
- Third auth layer: User OAuth UAT for P2P access
- Auto-refresh of `user_access_token` with `.env` persistence

## [0.4.0] - 2026-03-04

### Added
- Multi-type messaging: image, file, rich text (post), sticker, audio
- Cookie heartbeat — auto-refresh CSRF every 4h to extend session
- Chat name auto-resolution — pass group name instead of `oc_xxx` ID

## [0.3.0] - 2026-03-01

### Added
- Initial release: 27 tools, 8 slash commands, dual backend
- User identity messaging via reverse-engineered Protobuf protocol
- Official API integration for docs, Bitable, wiki, drive, contacts
- Support for Claude Code, Claude Desktop, Cursor, VS Code, Windsurf
