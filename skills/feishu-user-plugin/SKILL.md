---
name: feishu-user-plugin
version: "1.3.6"
description: "All-in-one Feishu plugin — send messages as yourself (incl. batch_send), read group/P2P chats (auto-expands merge_forward), manage docs/tables/wiki/drive (image + file blocks, drive uploads, bitable attachments), OKR, calendar, multi-profile. v1.3.6: upload completeness, sheets:spreadsheet scope, batch_send, multi-profile, send_card_as_user (bot-default)."
allowed-tools: send_to_user, send_to_group, send_as_user, send_image_as_user, send_file_as_user, send_post_as_user, send_sticker_as_user, send_audio_as_user, batch_send, send_card_as_user, search_contacts, create_p2p_chat, get_chat_info, get_user_info, get_login_status, list_profiles, switch_profile, read_p2p_messages, list_user_chats, list_chats, read_messages, reply_message, forward_message, search_docs, read_doc, create_doc, create_doc_block, update_doc_block, list_bitable_tables, list_bitable_fields, search_bitable_records, batch_create_bitable_records, batch_update_bitable_records, upload_bitable_attachment, list_wiki_spaces, search_wiki, list_wiki_nodes, get_wiki_node, list_files, create_folder, upload_drive_file, find_user, download_image, download_file, list_user_okrs, get_okrs, list_okr_periods, list_calendars, list_calendar_events, get_calendar_event
user_invocable: true
---

# Feishu User Plugin

All-in-one Feishu plugin for Claude Code with three auth layers:
- **User Identity** (cookie auth): Send messages as yourself — text, image, file, rich text, sticker, audio
- **Official API** (app credentials): Read group messages, docs, tables, wiki, drive, contacts
- **User OAuth** (user_access_token): Read P2P (direct message) chat history

This plugin replaces and extends the official Feishu MCP. No need to install two packages.

## Trigger Conditions

Activate when the user mentions:
- Sending Feishu messages ("发飞书消息给 XXX", "send a message to XXX on Feishu")
- Reading Feishu chats ("读飞书群聊 / 单聊", "read Feishu chat history")
- Feishu documents ("搜飞书文档", "search Feishu docs")
- Feishu tables ("查飞书表格", "query Bitable")
- Feishu wiki ("搜飞书知识库", "search wiki")
- Login status ("飞书登录状态", "check Feishu login")

## 9 Built-in Skills

### /send — Send message as yourself
Parse "recipient: message" format, auto-detect user vs group, confirm before sending.

### /reply — Read messages and reply
Search chat → read recent messages → show summary → user picks a message → reply.

### /digest — Chat message digest
Search chat → read N days of messages → filter valuable content → summarize key insights.

### /search — Search contacts
Search users and groups by name, display results grouped by type.

### /doc — Document operations
Search (search_docs), read (read_doc), create (create_doc) — three in one.

### /table — Bitable operations
Query (list tables → list fields → search records), create records, update records.

### /wiki — Wiki management
List spaces (list_wiki_spaces), search content (search_wiki), browse nodes (list_wiki_nodes).

### /drive — Drive file management
List files in folders, create new folders in Feishu Drive.

### /status — Check login status
Check cookie / app credentials / UAT — all three auth layers at once.

## Auth Configuration

| Env Variable | Who Provides | Purpose | Required |
|---|---|---|---|
| LARK_COOKIE | **You** | Send messages as yourself | Yes (for messaging) |
| LARK_APP_ID | **You** (create a Feishu app) | Official API access | Yes |
| LARK_APP_SECRET | **You** (from your Feishu app) | Official API access | Yes |
| LARK_USER_ACCESS_TOKEN | **You** (OAuth flow) | Read P2P chat history | Yes (for P2P reading) |
| LARK_USER_REFRESH_TOKEN | **You** (OAuth flow) | UAT auto-refresh | Yes (for P2P reading) |

### Getting Your Cookie (Automated via Playwright)

**Prerequisite: Playwright MCP must be installed.** If not, run:
```
npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/mcp-server-playwright
```
Then restart Claude Code.

**Automated flow (recommended, zero manual cookie copying):**
> Just tell Claude Code: "Help me set up my Feishu cookie"
>
> Claude Code will automatically:
> 1. Open feishu.cn in a browser via Playwright
> 2. Show you the QR code — scan it with Feishu mobile app
> 3. Extract the full cookie (including HttpOnly) via `context.cookies()`
> 4. Write it to your `.mcp.json` LARK_COOKIE field
> 5. Prompt you to restart Claude Code

**Manual fallback (if Playwright is unavailable):**
1. Open https://www.feishu.cn/messenger/ and log in
2. DevTools → **Network** tab → Disable cache → Reload
3. Click the first request → Request Headers → **Cookie** → right-click → Copy value
4. Paste into your `.mcp.json` env `LARK_COOKIE` field

> Do NOT use `document.cookie` or Application → Cookies — they miss HttpOnly cookies required for auth.

### Creating a Feishu App (for Official API)

1. Go to https://open.feishu.cn/app → Create Custom App (自建应用)
2. Add scopes: `im:message`, `im:message:readonly`, `im:chat:readonly`, `contact:user.base:readonly`
3. Copy the App ID and App Secret to your `.mcp.json`
4. Add the bot to any group chats you want to read

## Known Limitations

- Image/file sending requires uploading via Official API first to get keys
- CARD message type (type=14) not yet supported
- Cookie session valid for ~12h, auto-refreshed via built-in heartbeat (4h interval)
