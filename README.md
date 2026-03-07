# feishu-user-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

**English** | [中文](README_CN.md)

**All-in-one Feishu/Lark MCP Server — 27 tools for messaging, docs, tables, wiki, and drive.**

The only MCP server that lets you send messages as your **personal identity** (not a bot), while also integrating the full official Feishu API for documents, spreadsheets, wikis, and more.

## Why This Exists

Feishu's official API has a hard limitation: **there is no `send_as_user` scope**. Even with `user_access_token` (OAuth), messages still show `sender_type: "app"`.

This project combines two approaches into one plugin:

```
User Identity (cookie):     You → Protobuf → Feishu (messages show as YOU)
Official API  (app token):  You → REST API → Feishu (docs, tables, wiki, drive)
```

**One plugin. Everything Feishu. No other MCP needed.**

## Tools (27 total)

### User Identity (reverse-engineered protocol)
| Tool | Description |
|------|-------------|
| `send_to_user` | Search user + send message — one step |
| `send_to_group` | Search group + send message — one step |
| `send_as_user` | Send to any chat by ID |
| `search_contacts` | Search users, bots, groups |
| `create_p2p_chat` | Create/get direct message chat |
| `get_chat_info` | Group details (name, members, owner) |
| `get_user_info` | User display name lookup |
| `get_login_status` | Check session status |

### IM — Official API
| Tool | Description |
|------|-------------|
| `list_chats` | List all chats the bot joined |
| `read_messages` | Read message history from a chat |
| `reply_message` | Reply to a specific message |
| `forward_message` | Forward message to another chat |

### Documents — Official API
| Tool | Description |
|------|-------------|
| `search_docs` | Search documents by keyword |
| `read_doc` | Read document content |
| `create_doc` | Create new document |

### Bitable (Spreadsheets) — Official API
| Tool | Description |
|------|-------------|
| `list_bitable_tables` | List tables in a Bitable app |
| `list_bitable_fields` | List columns in a table |
| `search_bitable_records` | Query records with filter/sort |
| `create_bitable_record` | Create new record |
| `update_bitable_record` | Update existing record |

### Wiki — Official API
| Tool | Description |
|------|-------------|
| `list_wiki_spaces` | List accessible wiki spaces |
| `search_wiki` | Search wiki nodes |
| `list_wiki_nodes` | Browse wiki node tree |

### Drive — Official API
| Tool | Description |
|------|-------------|
| `list_files` | List files in a folder |
| `create_folder` | Create new folder |

### Contact — Official API
| Tool | Description |
|------|-------------|
| `find_user` | Find user by email or mobile |

## Installation

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
// Run in Claude Code or Playwright script:
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
# User identity messaging (reverse-engineered)
LARK_COOKIE=paste_your_cookie_here

# Official API (docs, tables, wiki, drive)
# Create app at https://open.feishu.cn → App ID & Secret
LARK_APP_ID=cli_xxxxx
LARK_APP_SECRET=xxxxx
```

> **Note**: Cookie is required for user-identity messaging. App credentials are required for docs/tables/wiki. You can configure either or both.

### 4. Verify

```bash
node src/test-send.js              # Check login status
node src/test-send.js search 张三   # Search contacts
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

Then you can say:
- "给张三发消息说明天下午开会"
- "搜索一下飞书里有哪些群"
- "检查一下飞书登录状态"

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
| `/reply` | `/reply 工坊群` | Read messages and reply |
| `/digest` | `/digest 工坊群 7` | Digest recent chat messages |
| `/search` | `/search 技术` | Search contacts and groups |
| `/doc` | `/doc search MCP` | Search/read/create documents |
| `/table` | `/table query appXxx` | Query/create Bitable records |
| `/wiki` | `/wiki search 协议` | Search/browse wiki |
| `/status` | `/status` | Check login status |

To use, copy `.claude/commands/` into your project.

## How It Works

```
┌──────────────┐     Cookie Auth     ┌──────────────────────────────────────┐
│  MCP Client  │ ───────────────────→ │  internal-api-lark-api.feishu.cn     │
│  (Claude etc)│ ←───────────────── │  /im/gateway/ (Protobuf over HTTP)   │
└──────────────┘     Protobuf        └──────────────────────────────────────┘
```

**Protocol**: HTTP POST with `application/x-protobuf` content type to Feishu's internal gateway.

| cmd | Operation | Proto Message |
|-----|-----------|---------------|
| 5 | Send message | `PutMessageRequest` |
| 13 | Create chat | `PutChatRequest` |
| 64 | Get chat info | `GetGroupInfoRequest` |
| 5023 | Get user info | `GetUserInfoRequest` |
| 11021 | Search | `UniversalSearchRequest` |

**Auth flow**:
1. POST `/accounts/csrf` → get `swp_csrf_token` from Set-Cookie
2. GET `/accounts/web/user` with CSRF token → get user ID & name
3. Use cookie + CSRF for all subsequent Protobuf gateway requests

Based on protocol research from [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) (Python), completely rewritten in Node.js with MCP integration.

## Cookie Lifecycle

- Feishu web sessions typically last **12-24 hours**
- When expired, the MCP server throws an auth error on init
- Re-login at feishu.cn and update `LARK_COOKIE` in `.env`
- Use `get_login_status` tool to check session health proactively

## Limitations

- Cookie-based auth requires periodic manual refresh
- Depends on Feishu's internal protocol — may break if Feishu updates their web client
- Text messages only (no rich text, images, or cards yet)
- No real-time message receiving (WebSocket not yet implemented)
- May violate Feishu's Terms of Service — use at your own risk

## Project Structure

```
feishu-user-mcp/
├── src/
│   ├── index.js        # MCP server entry (27 tools)
│   ├── client.js       # User identity client (Protobuf)
│   ├── official.js     # Official API client (REST)
│   ├── utils.js        # ID generators, cookie parser
│   └── test-send.js    # CLI test tool
├── proto/
│   └── lark.proto      # Protobuf message definitions
├── .claude/
│   └── commands/       # 8 Claude Code skills
├── CLAUDE.md           # AI project instructions
├── server.json         # MCP Registry manifest
├── .env.example        # Configuration template
└── package.json
```

## Contributing

Issues and PRs welcome. If Feishu updates their protocol, please open an issue with the error details so we can fix it quickly.

## License

[MIT](LICENSE)

## Acknowledgments

- [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) — Original Feishu protocol reverse-engineering
- [cv-cat/OpenFeiShuApis](https://github.com/cv-cat/OpenFeiShuApis) — Underlying API research
- [Model Context Protocol](https://modelcontextprotocol.io) — The MCP standard
