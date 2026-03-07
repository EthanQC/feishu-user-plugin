# feishu-user-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-33-orange.svg)](#tools-33-total)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**English** | [中文](README_CN.md)

**All-in-one Feishu/Lark MCP Server — 33 tools, 8 skills, three auth layers for messaging, docs, tables, wiki, and drive.**

The only MCP server that lets you send messages as your **personal identity** (not a bot), while also integrating the full official Feishu API for documents, spreadsheets, wikis, and more.

## Highlights

- **Send as yourself** — Messages show your real name, not a bot. Supports text, rich text, images, files, stickers, and audio.
- **Read everything** — Group chats via bot API, P2P (direct messages) via OAuth UAT.
- **Full Feishu suite** — Docs, Bitable (spreadsheets), Wiki, Drive, Contacts — all in one plugin.
- **Auto session management** — Cookie heartbeat every 4h, UAT auto-refresh with token rotation.
- **Chat name resolution** — Pass a group name instead of `oc_xxx` ID; it resolves automatically.

## Why This Exists

Feishu's official API has a hard limitation: **there is no `send_as_user` scope**. Even with `user_access_token` (OAuth), messages still show `sender_type: "app"`.

This project combines three auth layers into one plugin:

```
User Identity (cookie):     You → Protobuf → Feishu (messages appear as YOU)
Official API  (app token):  You → REST API → Feishu (docs, tables, wiki, drive)
User OAuth    (UAT):        You → REST API → Feishu (read P2P chats, list all chats)
```

**One plugin. Everything Feishu. No other MCP needed.**

## Tools (33 total)

### User Identity — Messaging (reverse-engineered, cookie-based)

| Tool | Description |
|------|-------------|
| `send_to_user` | Search user by name + send text — one step |
| `send_to_group` | Search group by name + send text — one step |
| `send_as_user` | Send text to any chat by ID, supports reply threading (`root_id` / `parent_id`) |
| `send_image_as_user` | Send image (requires `image_key` from upload) |
| `send_file_as_user` | Send file (requires `file_key` from upload) |
| `send_post_as_user` | Send rich text with title + formatted paragraphs (links, @mentions) |
| `send_sticker_as_user` | Send sticker/emoji |
| `send_audio_as_user` | Send audio message |

### User Identity — Contacts & Info

| Tool | Description |
|------|-------------|
| `search_contacts` | Search users, bots, or group chats by name |
| `create_p2p_chat` | Create/get P2P (direct message) chat, returns numeric `chat_id` |
| `get_chat_info` | Group details: name, description, member count, owner |
| `get_user_info` | User display name lookup by user ID |
| `get_login_status` | Check cookie, app credentials, and UAT status |

### User OAuth UAT — P2P Chat Reading

| Tool | Description |
|------|-------------|
| `read_p2p_messages` | Read P2P (direct message) history. Works for chats the bot cannot access. |
| `list_user_chats` | List all chats the user is in, including P2P. |

### Official API — IM (Bot Identity)

| Tool | Description |
|------|-------------|
| `list_chats` | List all chats the bot has joined |
| `read_messages` | Read message history (accepts chat name or `oc_xxx` ID) |
| `reply_message` | Reply to a specific message by `message_id` (as bot) |
| `forward_message` | Forward a message to another chat |

### Official API — Documents

| Tool | Description |
|------|-------------|
| `search_docs` | Search documents by keyword |
| `read_doc` | Read raw text content of a document |
| `create_doc` | Create a new document |

### Official API — Bitable (Spreadsheets)

| Tool | Description |
|------|-------------|
| `list_bitable_tables` | List all tables in a Bitable app |
| `list_bitable_fields` | List all fields (columns) in a table |
| `search_bitable_records` | Query records with filter and sort |
| `create_bitable_record` | Create a new record (row) |
| `update_bitable_record` | Update an existing record |

### Official API — Wiki

| Tool | Description |
|------|-------------|
| `list_wiki_spaces` | List all accessible wiki spaces |
| `search_wiki` | Search wiki/docs by keyword |
| `list_wiki_nodes` | Browse wiki node tree |

### Official API — Drive

| Tool | Description |
|------|-------------|
| `list_files` | List files in a folder |
| `create_folder` | Create a new folder |

### Official API — Contacts

| Tool | Description |
|------|-------------|
| `find_user` | Find user by email or mobile number |

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/EthanQC/feishu-user-mcp.git
cd feishu-user-mcp
npm install
```

### 2. Get Your Cookie

Login to [feishu.cn/messenger](https://www.feishu.cn/messenger/) in your browser, then extract cookies.

> **Important**: You need HttpOnly cookies (like `session`), which `document.cookie` cannot access.

<details>
<summary><strong>Option A: Browser DevTools (Manual)</strong></summary>

1. Open `F12` → `Application` → `Cookies` → `https://www.feishu.cn`
2. Select all cookies, right-click → Copy
3. Format as `name1=value1; name2=value2; ...` string

</details>

<details>
<summary><strong>Option B: Playwright (Recommended — gets HttpOnly cookies automatically)</strong></summary>

If you have [Playwright MCP](https://github.com/anthropics/mcp-playwright) configured:

```js
const cookies = await context.cookies('https://www.feishu.cn');
const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
```

</details>

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Required — user identity messaging (reverse-engineered)
LARK_COOKIE=paste_your_cookie_here

# Required — official API (docs, tables, wiki, drive, bot IM)
LARK_APP_ID=cli_xxxxx
LARK_APP_SECRET=xxxxx

# Optional — P2P chat reading (run: node src/oauth.js)
LARK_USER_ACCESS_TOKEN=
LARK_USER_REFRESH_TOKEN=
```

> Cookie is required for user-identity messaging. App credentials are required for official API tools. UAT is optional, only needed for P2P chat reading.

### 4. (Optional) Enable P2P Chat Reading

To read direct message history with `read_p2p_messages`:

1. Your Feishu app must be a **自建应用** (custom app)
2. Add scopes: `im:message`, `im:message:readonly`, `im:chat:readonly`
3. Set OAuth redirect URI to `http://127.0.0.1:9997/callback`
4. Run authorization:

```bash
node src/oauth.js
```

This opens a browser for OAuth consent, then saves the UAT to `.env` automatically. The token auto-refreshes when it expires.

### 5. Verify

```bash
node src/test-send.js              # Check login status
node src/test-send.js search 张三   # Search contacts
node src/test-all.js               # Run full test suite
```

## Client Setup

<details>
<summary><strong>Claude Code</strong></summary>

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "feishu-user-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/feishu-user-mcp/src/index.js"],
      "env": {}
    }
  }
}
```

Then just say:
- "给张三发消息说明天下午开会"
- "帮我看一下技术群最近聊了什么"
- "搜索飞书文档里关于 MCP 的内容"

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "feishu-user-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/feishu-user-mcp/src/index.js"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "feishu-user-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/feishu-user-mcp/src/index.js"]
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code (Copilot)</strong></summary>

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "feishu-user-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/feishu-user-mcp/src/index.js"]
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "feishu-user-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/feishu-user-mcp/src/index.js"]
    }
  }
}
```

</details>

## Claude Code Skills

This repo includes 8 ready-to-use [slash commands](https://docs.anthropic.com/en/docs/claude-code/tutorials#create-custom-slash-commands) in `.claude/commands/`:

| Skill | Usage | Description |
|-------|-------|-------------|
| `/send` | `/send 张三: 明天下午3点开会` | Send message as yourself |
| `/reply` | `/reply 工坊群` | Read recent messages and reply |
| `/digest` | `/digest 工坊群 7` | Summarize recent chat messages |
| `/search` | `/search 技术` | Search contacts and groups |
| `/doc` | `/doc search MCP` | Search, read, or create documents |
| `/table` | `/table query appXxx` | Query or create Bitable records |
| `/wiki` | `/wiki search 协议` | Search and browse wiki |
| `/status` | `/status` | Check login and auth status |

To use, copy `.claude/commands/` into your project.

## Architecture

```
┌──────────────┐                    ┌──────────────────────────────────────┐
│              │   Cookie + Proto   │  internal-api-lark-api.feishu.cn     │
│  MCP Client  │ ──────────────────→│  /im/gateway/ (Protobuf over HTTP)   │
│  (Claude,    │                    └──────────────────────────────────────┘
│   Cursor,    │   App Token (REST) ┌──────────────────────────────────────┐
│   VS Code)   │ ──────────────────→│  open.feishu.cn/open-apis/           │
│              │                    │  (Official REST API)                 │
│              │   User OAuth (REST)┌──────────────────────────────────────┐
│              │ ──────────────────→│  open.feishu.cn/open-apis/           │
└──────────────┘                    │  (UAT — P2P chat reading)            │
                                    └──────────────────────────────────────┘
```

### Protobuf Commands (User Identity Layer)

| cmd | Operation | Proto Message |
|-----|-----------|---------------|
| 5 | Send message (text, image, file, post, sticker, audio) | `PutMessageRequest` |
| 13 | Create P2P chat | `PutChatRequest` |
| 64 | Get group info | `GetGroupInfoRequest` |
| 5023 | Get user info | `GetUserInfoRequest` |
| 11021 | Universal search | `UniversalSearchRequest` |

### Auth Flow

1. **Cookie init**: POST `/accounts/csrf` → get `swp_csrf_token` + refresh `sl_session`
2. **User verify**: GET `/accounts/web/user` with CSRF → get user ID & name
3. **Heartbeat**: CSRF refresh every 4h keeps `sl_session` alive (12h max-age)
4. **UAT refresh**: Auto-refresh `user_access_token` using `refresh_token` when expired

## Session & Token Lifecycle

| Auth Layer | Token | Lifetime | Refresh |
|------------|-------|----------|---------|
| Cookie | `sl_session` | 12h max-age | Auto-refreshed every 4h via heartbeat |
| App Token | `tenant_access_token` | 2h | Auto-managed by SDK |
| User OAuth | `user_access_token` | ~2h | Auto-refreshed via `refresh_token`, saved to `.env` |

When the cookie expires (after ~12-24h without heartbeat), re-login at feishu.cn and update `LARK_COOKIE` in `.env`. Use `get_login_status` to check health proactively.

## Project Structure

```
feishu-user-mcp/
├── src/
│   ├── index.js          # MCP server entry point (33 tools)
│   ├── client.js         # User identity client (Protobuf gateway)
│   ├── official.js       # Official API client (REST, UAT)
│   ├── utils.js          # ID generators, cookie parser
│   ├── oauth.js          # OAuth flow for user_access_token
│   ├── oauth-auto.js     # Automated OAuth with Playwright
│   ├── test-send.js      # Quick CLI test
│   └── test-all.js       # Full test suite
├── proto/
│   └── lark.proto        # Protobuf message definitions
├── .claude/
│   └── commands/         # 8 Claude Code slash commands
├── .github/              # Issue & PR templates
├── CLAUDE.md             # AI project instructions
├── CHANGELOG.md          # Version history
├── CONTRIBUTING.md       # Contribution guide
├── server.json           # MCP Registry manifest
├── .env.example          # Configuration template
└── package.json
```

## Limitations

- Cookie-based auth requires periodic refresh (auto-heartbeat extends to ~12h; manual re-login needed after that)
- Depends on Feishu's internal Protobuf protocol — may break if Feishu updates their web client
- Image/file/audio sending requires pre-uploaded keys (upload via Official API or external bridge)
- No real-time message receiving (WebSocket push not yet implemented)
- `get_user_info` may return null for some users due to proto definition limitations
- May violate Feishu's Terms of Service — use at your own risk

## Contributing

Issues and PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and submission guidelines.

If Feishu updates their protocol and something breaks, please [open an issue](https://github.com/EthanQC/feishu-user-mcp/issues/new?template=bug_report.md) with the error details so we can fix it quickly.

## License

[MIT](LICENSE)

## Acknowledgments

- [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) — Original Feishu protocol reverse-engineering (Python)
- [cv-cat/OpenFeiShuApis](https://github.com/cv-cat/OpenFeiShuApis) — Underlying API research
- [Model Context Protocol](https://modelcontextprotocol.io) — The MCP standard
