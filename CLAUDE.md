# feishu-user-mcp — Claude Code Instructions

## What This Is
All-in-one Feishu MCP Server with three auth layers:
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
- `read_p2p_messages` — Read P2P (direct message) chat history. Requires OAuth setup.
- `list_user_chats` — List all chats the user is in (including P2P). Requires OAuth setup.

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
- Read P2P chat history → `read_p2p_messages` (requires OAuth UAT)
- Reply as user in thread → `send_as_user` with root_id
- Reply as bot → `reply_message` (official API)
- Diagnose issues → `get_login_status` first

## Auth & Session
- **LARK_COOKIE**: Required for user identity tools. Session auto-refreshed every 4h via heartbeat.
- **LARK_APP_ID + LARK_APP_SECRET**: Required for official API tools.
- **LARK_USER_ACCESS_TOKEN**: Required for P2P reading. Obtained via `node src/oauth.js`. Auto-refreshed.
- Cookie expiry: sl_session has 12h max-age, auto-refreshed by heartbeat.

## P2P Chat Reading Setup
To enable `read_p2p_messages` and `list_user_chats`, the Feishu app needs:
1. App type: 自建应用 (custom app), NOT marketplace/b2c/b2b
2. Scopes: `im:message`, `im:message:readonly`, `im:chat:readonly`
3. OAuth redirect URI: `http://127.0.0.1:9997/callback`
4. Run `node src/oauth.js` to authorize and save the UAT

## Known Limitations
- Image/file upload must go through Official API or feishu-file-bridge first to obtain keys
- CARD message type (type=14) not yet implemented — complex JSON schema
