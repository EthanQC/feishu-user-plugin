# feishu-user-mcp — Claude Code Instructions

## What This Is
All-in-one Feishu MCP Server with two backends:
- **User Identity** (cookie auth): Send messages as yourself, search contacts, manage chats
- **Official API** (app credentials): Read messages, docs, tables, wiki, drive, contacts

## Tool Categories

### User Identity Tools (reverse-engineered, cookie-based)
- `send_to_user` — Search user + send message (one step, most common)
- `send_to_group` — Search group + send message (one step)
- `send_as_user` — Send to any chat by ID
- `search_contacts` — Search users/groups by name
- `create_p2p_chat` — Create/get P2P chat
- `get_chat_info` — Group details (name, members, owner)
- `get_user_info` — User display name lookup
- `get_login_status` — Check both cookie and app status

### Official API Tools (app credentials)
- `list_chats` / `read_messages` — Chat history
- `reply_message` / `forward_message` — Message operations
- `search_docs` / `read_doc` / `create_doc` — Document operations
- `list_bitable_tables` / `list_bitable_fields` / `search_bitable_records` — Table queries
- `create_bitable_record` / `update_bitable_record` — Table writes
- `list_wiki_spaces` / `search_wiki` / `list_wiki_nodes` — Wiki
- `list_files` / `create_folder` — Drive
- `find_user` — Contact lookup by email/mobile

## Usage Patterns
- Send message as yourself → `send_to_user` or `send_to_group`
- Read chat history → `read_messages` (official API)
- Reply to specific message → `reply_message` (official API)
- Work with docs/tables/wiki → use official API tools
- Diagnose issues → `get_login_status` first

## Auth Requirements
- **LARK_COOKIE**: Required for user identity tools. Expires every 12-24h.
- **LARK_APP_ID + LARK_APP_SECRET**: Required for official API tools. Create app at open.feishu.cn.
