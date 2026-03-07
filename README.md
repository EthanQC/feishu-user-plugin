# feishu-user-mcp

MCP Server for Feishu (Lark) that operates with **your personal user identity** — not a bot.

Send messages as yourself, search contacts, create P2P chats — all through Claude Code or any MCP-compatible client.

## Why?

Feishu's official API only supports `send_as_bot`. Even with `user_access_token`, messages show `sender_type: "app"`. This project reverse-engineers Feishu's internal Protobuf protocol to enable true user-identity messaging.

## Features

| Tool | Description |
|------|-------------|
| `send_as_user` | Send a message as yourself to any chat |
| `search_contacts` | Search users and groups by name |
| `create_p2p_chat` | Create or get a P2P chat with a user |
| `send_to_user` | Search + create chat + send — all in one step |
| `get_login_status` | Check if your cookie session is still valid |

## Quick Start

### 1. Install

```bash
git clone https://github.com/EthanQC/feishu-user-mcp.git
cd feishu-user-mcp
npm install
```

### 2. Get Your Cookie

Login to [feishu.cn](https://www.feishu.cn/messenger/) in your browser, then grab cookies via DevTools:

**Option A: DevTools Console**
```
F12 → Application → Cookies → feishu.cn → Copy all cookies as "name=value; name2=value2; ..." string
```

**Option B: Playwright (recommended, gets HttpOnly cookies)**
```js
const cookies = await context.cookies('https://www.feishu.cn');
const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
```

### 3. Configure

```bash
cp .env.example .env
# Paste your cookie string into .env
```

### 4. Add to Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "feishu-user-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/feishu-user-mcp/src/index.js"],
      "env": {}
    }
  }
}
```

### 5. Test

```bash
node src/test-send.js <chatId> "Hello from user identity!"
```

## How It Works

This project reverse-engineers Feishu's web client protocol:

1. **Authentication**: Uses browser session cookies (not OAuth)
2. **Protocol**: Protobuf-encoded messages over HTTP POST to `internal-api-lark-api.feishu.cn/im/gateway/`
3. **Commands**: `cmd=5` (send message), `cmd=13` (create chat), `cmd=11021` (search), `cmd=5023` (get user info)

Based on research from [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) (Python), rewritten in Node.js with MCP integration.

## Limitations

- Cookie sessions expire — you'll need to refresh periodically
- Depends on Feishu's internal protocol — may break if Feishu updates
- No real-time message receiving yet (WebSocket not implemented)
- May violate Feishu's terms of service — use at your own risk

## License

MIT
