# feishu-user-plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-76-orange.svg)](#tools)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**All-in-one Feishu/Lark MCP Server -- 76 tools, 9 skills, 3 auth layers for messaging, docs, bitable, calendar, tasks, drive, and more.**

The only MCP server that lets you send messages as your **personal identity** (not a bot), while also integrating the full official Feishu API. Works with Claude Code, Cursor, Windsurf, OpenClaw, and any MCP-compatible client.

## Highlights

- **Send as yourself** -- Messages show your real name, not a bot. Supports text, rich text, images, files, stickers, and audio.
- **Read everything** -- Group chats via bot API, P2P (direct messages) via OAuth UAT.
- **Full Feishu suite** -- Docs, Bitable, Wiki, Drive, Calendar, Tasks, Contacts -- all in one plugin.
- **3 auth layers** -- Cookie-based user identity, app credentials (Official API), and OAuth UAT (P2P reading).
- **Group management** -- Create groups, add/remove members, pin messages, emoji reactions.
- **Document editing** -- Not just read/create, but insert/update/delete content blocks.
- **Calendar & Tasks** -- Create events, check free/busy, manage tasks.
- **9 slash commands** for Claude Code -- `/send`, `/reply`, `/search`, `/digest`, `/doc`, `/table`, `/wiki`, `/drive`, `/status`
- **Auto session management** -- Cookie heartbeat every 4h, UAT auto-refresh with token rotation.
- **Multi-platform** -- Claude Code, Cursor, Windsurf, VS Code, OpenClaw.

## Why This Exists

Feishu's official API has a hard limitation: **there is no `send_as_user` scope**. Even with `user_access_token` (OAuth), messages still show `sender_type: "app"`.

This project combines three auth layers into one plugin:

```
User Identity (cookie):     You -> Protobuf -> Feishu (messages appear as YOU)
Official API  (app token):  You -> REST API -> Feishu (docs, tables, wiki, drive)
User OAuth    (UAT):        You -> REST API -> Feishu (read P2P chats, list all chats)
```

**One plugin. Everything Feishu. No other MCP needed.**

## Quick Start

### Option 1: npx (recommended)

```bash
npx feishu-user-plugin
```

No installation needed. The package runs directly via npx.

### Option 2: Clone and run locally

```bash
git clone https://github.com/EthanQC/feishu-user-plugin.git
cd feishu-user-plugin
npm install
npm start
```

## Create Your Feishu App

To use the Official API tools (docs, tables, wiki, drive, bot messaging), you need to create a Feishu app:

### Step 1: Create the App

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) and log in
2. Click **Create Custom App** (创建自建应用) -- you must choose **Custom App** (自建应用), NOT marketplace/third-party types
3. Fill in the app name and description, then create it

### Step 2: Enable Bot Capability

1. In your app settings, go to **Add Capabilities** (添加应用能力)
2. Enable **Bot** (机器人)

### Step 3: Add Permissions (Scopes)

Go to **Permissions & Scopes** (权限管理) and add the following scopes:

| Scope | Purpose |
|-------|---------|
| `im:message` | Send messages as bot |
| `im:message:readonly` | Read message history |
| `im:chat:readonly` | List and read chats |
| `docx:document` | Read and create documents |
| `docx:document:readonly` | Read documents |
| `bitable:record` | Read and write Bitable records |
| `wiki:wiki:readonly` | Read wiki spaces and nodes |
| `drive:drive:readonly` | List Drive files and folders |
| `contact:user.base:readonly` | Look up users by email/mobile |

> Add more scopes as needed depending on which tools you use.

### Step 4: Get App Credentials

1. Go to **Credentials & Basic Info** (凭证与基础信息)
2. Copy the **App ID** (`cli_xxxxxxxxxxxx`) and **App Secret**
3. Set them as `LARK_APP_ID` and `LARK_APP_SECRET` in your environment

### Step 5: Publish and Approve

1. **Create a version** and submit it for review (创建版本)
2. Have your organization admin approve the app (管理员审核)
3. After approval, the app is live

### Step 6: Add Bot to Group Chats

Add your bot to the group chats where you want it to read messages. The bot can only access chats it has been added to.

## Environment Variables

| Variable | Required For | Description |
|----------|-------------|-------------|
| `LARK_COOKIE` | User identity tools | Feishu web session cookie string. Needed for `send_to_user`, `send_to_group`, `search_contacts`, etc. |
| `LARK_APP_ID` | Official API tools | App ID from Feishu Open Platform. Needed for `read_messages`, docs, tables, wiki, drive. |
| `LARK_APP_SECRET` | Official API tools | App Secret from Feishu Open Platform. Used together with `LARK_APP_ID`. |
| `LARK_USER_ACCESS_TOKEN` | P2P chat reading | OAuth user token. Needed for `read_p2p_messages` and `list_user_chats`. Obtained via `node src/oauth.js`. |
| `LARK_USER_REFRESH_TOKEN` | UAT auto-refresh | Refresh token for automatic UAT renewal. Obtained together with UAT via OAuth flow. |

All five variables are required for full functionality. Configure all of them during setup.

## How to Get Your Cookie

**Option A: Automated via Playwright MCP (recommended, zero manual copying)**

First, install Playwright MCP if you don't have it:
```bash
npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/mcp-server-playwright
```

Then just tell Claude Code: **"Help me set up my Feishu cookie"**

Claude Code will automatically:
1. Open feishu.cn in a browser via Playwright
2. Show you the QR code — scan it with Feishu mobile app
3. Extract the full cookie (including HttpOnly) via `context.cookies()`
4. Write it to your `.mcp.json` LARK_COOKIE field
5. Prompt you to restart Claude Code

**Option B: Manual (via Network tab)**

1. Open [feishu.cn/messenger](https://www.feishu.cn/messenger/) in your browser and log in
2. Open DevTools (`F12` or `Cmd+Option+I`)
3. Go to the **Network** tab → check **Disable cache** → press `Cmd+R` to reload
4. Click the first request in the list (usually the page itself)
5. In the right panel, find **Request Headers** → **Cookie:** → right-click → **Copy value**
6. Set it as `LARK_COOKIE` in your environment

> Do NOT use `document.cookie` in the Console or copy from Application → Cookies tab — they miss HttpOnly cookies (`session`, `sl_session`) required for auth.

> The server automatically refreshes the session via heartbeat every 4 hours. The `sl_session` cookie has a 12-hour max-age.

## Set Up OAuth (Required for P2P Chat Reading)

To enable `read_p2p_messages` and `list_user_chats`:

1. Your Feishu app must be a **Custom App** (自建应用), NOT marketplace/third-party
2. Add scopes: `im:message`, `im:message:readonly`, `im:chat:readonly`
3. In your app's **Security Settings** (安全设置), add the OAuth redirect URI: `http://127.0.0.1:9997/callback`
4. **Important**: Make sure "对外共享" (external sharing) is **disabled** in your app version settings — enabling it marks the app as b2c/b2b type, which blocks P2P chat access
5. Run the authorization flow:

```bash
# If you cloned the repo:
node src/oauth.js

# If you installed via npx:
cd $(npm root -g)/feishu-user-plugin && node src/oauth.js
# Or clone the repo just for the OAuth step, then use npx for daily use
```

A browser window will open for OAuth consent. The token is saved to `.env` automatically and auto-refreshes at runtime. Add both `LARK_USER_ACCESS_TOKEN` and `LARK_USER_REFRESH_TOKEN` from `.env` to your MCP config's `env` section.

## MCP Client Configuration

### Claude Code

Add to your project's `.mcp.json` (or `~/.claude/.mcp.json` for global):

**Using npx:**

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

**Using a local clone:**

```json
{
  "mcpServers": {
    "feishu": {
      "command": "node",
      "args": ["/absolute/path/to/feishu-user-plugin/src/index.js"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

Then just say things like:
- "Send a message to Alice saying the meeting is at 3pm"
- "What did the engineering group chat about today?"
- "Search for docs about MCP"

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### VS Code (Copilot)

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "feishu": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### OpenClaw

Add to `~/.openclaw/openclaw.json` (note: key path is `mcp.servers`, not `mcpServers`):

```json
{
  "mcp": {
    "servers": {
      "feishu-user-plugin": {
        "command": "npx",
        "args": ["-y", "feishu-user-plugin"],
        "env": {
          "LARK_COOKIE": "your-cookie-string",
          "LARK_APP_ID": "cli_xxxxxxxxxxxx",
          "LARK_APP_SECRET": "your-app-secret",
          "LARK_USER_ACCESS_TOKEN": "your-uat",
          "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
        }
      }
    }
  }
}
```

Or via CLI: `openclaw mcp set feishu-user-plugin '{"command":"npx","args":["-y","feishu-user-plugin"],"env":{...}}'`

> OpenClaw's built-in Feishu channel handles receiving messages (bot identity). This plugin adds user identity messaging + docs/bitable/calendar/tasks.

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

## Tools (76 total)

### User Identity -- Messaging (8 tools, cookie auth)

| Tool | Description |
|------|-------------|
| `send_to_user` | Search user by name + send text -- one step |
| `send_to_group` | Search group by name + send text -- one step |
| `send_as_user` | Send text to any chat by ID, supports reply threading |
| `send_image_as_user` | Send image (requires `image_key` from `upload_image`) |
| `send_file_as_user` | Send file (requires `file_key` from `upload_file`) |
| `send_post_as_user` | Send rich text with title + formatted paragraphs |
| `send_sticker_as_user` | Send sticker/emoji |
| `send_audio_as_user` | Send audio message |

### User Identity -- Contacts & Info (5 tools, cookie auth)

| Tool | Description |
|------|-------------|
| `search_contacts` | Search users, bots, or group chats by name |
| `create_p2p_chat` | Create/get P2P (direct message) chat |
| `get_chat_info` | Group details (supports both oc_xxx and numeric ID) |
| `get_user_info` | User display name lookup by user ID |
| `get_login_status` | Check cookie, app credentials, and UAT status |

### User OAuth UAT -- P2P Chat Reading (2 tools)

| Tool | Description |
|------|-------------|
| `read_p2p_messages` | Read P2P (direct message) history |
| `list_user_chats` | List group chats the user is in |

### Official API -- IM (17 tools)

| Tool | Description |
|------|-------------|
| `list_chats` | List all chats the bot has joined |
| `read_messages` | Read message history (accepts chat name, oc_xxx, or numeric ID) |
| `send_message_as_bot` | Send message as bot to any chat |
| `reply_message` | Reply to a specific message (as bot) |
| `forward_message` | Forward a message to another chat |
| `delete_message` | Recall/delete a bot message |
| `update_message` | Edit a sent bot message |
| `add_reaction` | Add emoji reaction to a message |
| `delete_reaction` | Remove emoji reaction |
| `pin_message` | Pin a message in chat |
| `unpin_message` | Unpin a message |
| `create_group` | Create a new group chat |
| `update_group` | Update group name/description |
| `list_members` | List group members |
| `add_members` | Add users to a group |
| `remove_members` | Remove users from a group |
| `upload_image` / `upload_file` | Upload image/file, returns key for sending |

### Official API -- Documents (7 tools)

| Tool | Description |
|------|-------------|
| `search_docs` | Search documents by keyword |
| `read_doc` | Read raw text content |
| `get_doc_blocks` | Get structured block tree |
| `create_doc` | Create a new document |
| `create_doc_block` | Insert content blocks into a document |
| `update_doc_block` | Update a specific block |
| `delete_doc_blocks` | Delete a range of blocks |

### Official API -- Bitable (17 tools)

| Tool | Description |
|------|-------------|
| `create_bitable` | Create a new Bitable app |
| `list_bitable_tables` / `create_bitable_table` / `delete_bitable_table` | Table management |
| `list_bitable_fields` / `create_bitable_field` / `update_bitable_field` / `delete_bitable_field` | Field management |
| `list_bitable_views` | List views |
| `search_bitable_records` / `get_bitable_record` | Query records |
| `create_bitable_record` / `update_bitable_record` / `delete_bitable_record` | Single record CRUD |
| `batch_create_bitable_records` / `batch_update_bitable_records` / `batch_delete_bitable_records` | Batch operations (max 500/call) |

### Official API -- Calendar (5 tools)

| Tool | Description |
|------|-------------|
| `list_calendars` | List accessible calendars |
| `create_calendar_event` | Create a calendar event |
| `list_calendar_events` | List events in a calendar |
| `delete_calendar_event` | Delete an event |
| `get_freebusy` | Check user availability |

### Official API -- Tasks (5 tools)

| Tool | Description |
|------|-------------|
| `create_task` | Create a task |
| `get_task` | Get task details |
| `list_tasks` | List tasks |
| `update_task` | Update a task |
| `complete_task` | Mark task as complete |

### Official API -- Drive (5 tools)

| Tool | Description |
|------|-------------|
| `list_files` | List files in a folder |
| `create_folder` | Create a new folder |
| `copy_file` | Copy a file |
| `move_file` | Move a file |
| `delete_file` | Delete a file/folder |

### Official API -- Wiki & Contacts (4 tools)

| Tool | Description |
|------|-------------|
| `list_wiki_spaces` / `search_wiki` / `list_wiki_nodes` | Wiki spaces, search, browse |
| `find_user` | Find user by email or mobile number |

## Claude Code Slash Commands (9 skills)

This plugin includes 9 built-in skills in `skills/feishu-user-plugin/`:

| Skill | Usage | Description |
|-------|-------|-------------|
| `/send` | `/send Alice: meeting at 3pm` | Send message as yourself |
| `/reply` | `/reply engineering-chat` | Read recent messages and reply |
| `/digest` | `/digest engineering-chat 7` | Summarize recent chat messages |
| `/search` | `/search engineering` | Search contacts and groups |
| `/doc` | `/doc search MCP` | Search, read, or create documents |
| `/table` | `/table query appXxx` | Query or create Bitable records |
| `/wiki` | `/wiki search protocol` | Search and browse wiki |
| `/drive` | `/drive list folderToken` | List files or create folders in Drive |
| `/status` | `/status` | Check login and auth status |

Skills are automatically available when the plugin is installed.

## Architecture

```
                               Cookie + Proto   ┌──────────────────────────────────────┐
                             ────────────────── >│  internal-api-lark-api.feishu.cn     │
┌──────────────┐                                 │  /im/gateway/ (Protobuf over HTTP)   │
│  MCP Client  │                                 └──────────────────────────────────────┘
│  (Claude,    │  App Token (REST) ┌──────────────────────────────────────┐
│   Cursor,    │ ────────────────->│  open.feishu.cn/open-apis/           │
│   VS Code)   │                   │  (Official REST API)                 │
│              │                   └──────────────────────────────────────┘
│              │  User OAuth (REST)┌──────────────────────────────────────┐
│              │ ────────────────->│  open.feishu.cn/open-apis/           │
└──────────────┘                   │  (UAT -- P2P chat reading)           │
                                   └──────────────────────────────────────┘
```

## Session & Token Lifecycle

| Auth Layer | Token | Lifetime | Refresh |
|------------|-------|----------|---------|
| Cookie | `sl_session` | 12h max-age | Auto-refreshed every 4h via heartbeat |
| App Token | `tenant_access_token` | 2h | Auto-managed by SDK |
| User OAuth | `user_access_token` | ~2h | Auto-refreshed via `refresh_token`, saved to `.env` |

When the cookie expires (after ~12-24h without heartbeat), re-login at feishu.cn and update `LARK_COOKIE`. Use `get_login_status` to check health proactively.

## Project Structure

```
feishu-user-plugin/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── skills/
│   └── feishu-user-plugin/
│       ├── SKILL.md         # Main skill definition (trigger, tools, auth)
│       └── references/      # 8 skill reference docs + CLAUDE.md
├── src/
│   ├── index.js             # MCP server entry point (76 tools)
│   ├── client.js            # User identity client (Protobuf gateway)
│   ├── official.js          # Official API client (REST, UAT)
│   ├── utils.js             # ID generators, cookie parser
│   ├── oauth.js             # OAuth flow for user_access_token
│   ├── test-send.js         # Quick CLI test
│   └── test-all.js          # Full test suite
├── proto/
│   └── lark.proto           # Protobuf message definitions
├── .mcp.json.example        # MCP server config template
├── server.json              # MCP Registry manifest
├── .env.example             # Configuration template
└── package.json
```

## Limitations

- Cookie-based auth requires periodic refresh (auto-heartbeat extends to ~12h; manual re-login needed after that)
- Depends on Feishu's internal Protobuf protocol -- may break if Feishu updates their web client
- Image/file/audio sending requires pre-uploaded keys (upload via Official API or external bridge)
- No real-time message receiving (WebSocket push not yet implemented)
- May violate Feishu's Terms of Service -- use at your own risk

## Contributing

Issues and PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and submission guidelines.

If Feishu updates their protocol and something breaks, please [open an issue](https://github.com/EthanQC/feishu-user-plugin/issues/new?template=bug_report.md) with the error details.

## License

[MIT](LICENSE)

## Acknowledgments

- [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) -- Original Feishu protocol reverse-engineering (Python)
- [cv-cat/OpenFeiShuApis](https://github.com/cv-cat/OpenFeiShuApis) -- Underlying API research
- [Model Context Protocol](https://modelcontextprotocol.io) -- The MCP standard
