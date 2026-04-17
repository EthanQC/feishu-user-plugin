#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
// Local dev fallback: MCP clients inject env vars from config's env block at spawn time.
// This dotenv line only matters when running locally with a .env file (e.g. during development).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { LarkUserClient } = require('./client');
const { LarkOfficialClient } = require('./official');

// --- Chat ID Mapper ---

class ChatIdMapper {
  constructor() {
    this.nameCache = new Map(); // oc_id → chat name
    this.lastRefresh = 0;
    this.TTL = 5 * 60 * 1000; // 5 min cache
  }

  async _refresh(official) {
    if (Date.now() - this.lastRefresh < this.TTL) return;
    try {
      const chats = await official.listAllChats();
      this.nameCache.clear();
      for (const chat of chats) {
        this.nameCache.set(chat.chat_id, chat.name || '');
      }
      this.lastRefresh = Date.now();
    } catch (e) {
      console.error('[feishu-user-plugin] ChatIdMapper refresh failed:', e.message);
    }
  }

  // Case-insensitive name matching helper
  static _nameMatch(haystack, needle, exact = false) {
    if (!haystack || !needle) return false;
    const h = haystack.toLowerCase(), n = needle.toLowerCase();
    return exact ? h === n : h.includes(n);
  }

  async findByName(name, official) {
    await this._refresh(official);
    // Exact match first (case-insensitive)
    for (const [ocId, chatName] of this.nameCache) {
      if (ChatIdMapper._nameMatch(chatName, name, true)) return ocId;
    }
    // Partial match (case-insensitive)
    for (const [ocId, chatName] of this.nameCache) {
      if (ChatIdMapper._nameMatch(chatName, name)) return ocId;
    }
    return null;
  }

  async resolveToOcId(chatIdOrName, official) {
    if (!chatIdOrName) return null;
    if (chatIdOrName.startsWith('oc_')) return chatIdOrName;
    // Also accept raw numeric IDs (from search_contacts)
    if (/^\d+$/.test(chatIdOrName)) return chatIdOrName;
    // Strategy 1: Search in bot's group list cache
    const cached = await this.findByName(chatIdOrName, official);
    if (cached) return cached;
    // Strategy 2: Use im.v1.chat.search API (finds groups even if not in cache)
    try {
      const results = await official.chatSearch(chatIdOrName);
      for (const chat of results) {
        this.nameCache.set(chat.chat_id, chat.name || '');
        if (ChatIdMapper._nameMatch(chat.name, chatIdOrName, true)) return chat.chat_id;
      }
      // Partial match on search results (case-insensitive)
      for (const chat of results) {
        if (ChatIdMapper._nameMatch(chat.name, chatIdOrName)) return chat.chat_id;
      }
    } catch (e) {
      console.error('[feishu-user-plugin] chatSearch fallback failed:', e.message);
    }
    return null;
  }

  // Strategy 3: Use search_contacts (cookie-based) to find external groups by name
  // Returns numeric chat_id that works with UAT readMessagesAsUser
  async resolveViaContacts(chatName, userClient) {
    if (!userClient) return null;
    try {
      const results = await userClient.search(chatName);
      const groups = results.filter(r => r.type === 'group');
      // Exact match first (case-insensitive)
      for (const g of groups) {
        if (ChatIdMapper._nameMatch(g.title, chatName, true)) return String(g.id);
      }
      // Partial match (case-insensitive)
      for (const g of groups) {
        if (ChatIdMapper._nameMatch(g.title, chatName)) return String(g.id);
      }
    } catch (e) {
      console.error('[feishu-user-plugin] search_contacts fallback failed:', e.message);
    }
    return null;
  }
}

// --- Client Singletons ---

let userClient = null;
let officialClient = null;
const chatIdMapper = new ChatIdMapper();

async function getUserClient() {
  if (userClient) return userClient;
  const cookie = process.env.LARK_COOKIE;
  if (!cookie) throw new Error(
    'LARK_COOKIE not set. To fix:\n' +
    '1. Open https://www.feishu.cn/messenger/ and log in\n' +
    '2. DevTools → Network tab → Disable cache → Reload → Click first request → Request Headers → Cookie → Copy value\n' +
    '   (Do NOT use document.cookie or Application→Cookies — they miss HttpOnly cookies like session/sl_session)\n' +
    '3. Paste the cookie string into your .mcp.json env LARK_COOKIE field, then restart Claude Code\n' +
    'If Playwright MCP is available: navigate to feishu.cn/messenger/, let user log in, then use context.cookies() to get the full cookie string including HttpOnly cookies.'
  );
  userClient = new LarkUserClient(cookie);
  await userClient.init();
  return userClient;
}

function getOfficialClient() {
  if (officialClient) return officialClient;
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) throw new Error(
    'LARK_APP_ID and LARK_APP_SECRET not set.\n' +
    'For team members: these should be pre-filled in your .mcp.json. Check that the config was copied correctly from the team-skills README.\n' +
    'For external users: create a Custom App at https://open.feishu.cn/app, get the App ID and App Secret, add them to your .mcp.json env.'
  );
  officialClient = new LarkOfficialClient(appId, appSecret);
  officialClient.loadUAT();
  return officialClient;
}

// --- Tool Definitions ---

const TOOLS = [
  // ========== User Identity — Send Messages ==========
  {
    name: 'send_as_user',
    description: '[User Identity] Send a text message as the logged-in Feishu user. Supports reply threading and real @-mentions (triggers push notifications).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID (numeric)' },
        text: { type: 'string', description: 'Message text. If `ats` is provided, include the display marker for each @ in this text (default marker is `@<name>`).' },
        ats: {
          type: 'array',
          description: 'Optional @-mentions. Each entry: {userId: "ou_xxx", name: "DisplayName"}. The text must contain each @<name> marker in order — it gets spliced into a real AT element so the mentioned user receives a notification.',
          items: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, marker: { type: 'string' } } },
        },
        root_id: { type: 'string', description: 'Thread root message ID (for reply, optional)' },
        parent_id: { type: 'string', description: 'Parent message ID (for nested reply, optional)' },
      },
      required: ['chat_id', 'text'],
    },
  },
  {
    name: 'send_to_user',
    description: '[User Identity] Search user by name → create P2P chat → send text message. All in one step.',
    inputSchema: {
      type: 'object',
      properties: {
        user_name: { type: 'string', description: 'Recipient name (Chinese or English)' },
        text: { type: 'string', description: 'Message text' },
        ats: {
          type: 'array',
          description: 'Optional @-mentions. Same format as send_as_user.ats: [{userId, name}]. Text must contain the `@<name>` marker for each entry.',
          items: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, marker: { type: 'string' } } },
        },
      },
      required: ['user_name', 'text'],
    },
  },
  {
    name: 'send_to_group',
    description: '[User Identity] Search group by name → send text message. All in one step.',
    inputSchema: {
      type: 'object',
      properties: {
        group_name: { type: 'string', description: 'Group chat name' },
        text: { type: 'string', description: 'Message text' },
        ats: {
          type: 'array',
          description: 'Optional @-mentions that trigger real notifications. Each entry: {userId, name}. Text must contain `@<name>` marker for each entry.',
          items: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, marker: { type: 'string' } } },
        },
      },
      required: ['group_name', 'text'],
    },
  },
  {
    name: 'send_image_as_user',
    description: '[User Identity] Send an image as the logged-in user. Requires image_key (upload via Official API first).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID' },
        image_key: { type: 'string', description: 'Image key from upload (img_v2_xxx or img_v3_xxx)' },
        root_id: { type: 'string', description: 'Thread root message ID (optional)' },
      },
      required: ['chat_id', 'image_key'],
    },
  },
  {
    name: 'send_file_as_user',
    description: '[User Identity] Send a file as the logged-in user. Requires file_key (upload via Official API first).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID' },
        file_key: { type: 'string', description: 'File key from upload' },
        file_name: { type: 'string', description: 'Display file name' },
        root_id: { type: 'string', description: 'Thread root message ID (optional)' },
      },
      required: ['chat_id', 'file_key', 'file_name'],
    },
  },
  {
    name: 'send_sticker_as_user',
    description: '[User Identity] Send a sticker/emoji as the logged-in user.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID' },
        sticker_id: { type: 'string', description: 'Sticker ID' },
        sticker_set_id: { type: 'string', description: 'Sticker set ID' },
      },
      required: ['chat_id', 'sticker_id', 'sticker_set_id'],
    },
  },
  {
    name: 'send_post_as_user',
    description: '[User Identity] Send a rich text (POST) message with title and formatted paragraphs. Supports real @-mentions that trigger notifications.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID' },
        title: { type: 'string', description: 'Post title (optional)' },
        paragraphs: {
          type: 'array',
          description: 'Array of paragraphs. Each paragraph is an array of elements:\n• {tag:"text",text:"..."} — plain text\n• {tag:"a",href:"https://...",text:"display"} — hyperlink\n• {tag:"at",userId:"ou_xxx",name:"Display Name"} — real @-mention (triggers notification)',
          items: { type: 'array', items: { type: 'object' } },
        },
        root_id: { type: 'string', description: 'Thread root message ID (optional)' },
      },
      required: ['chat_id', 'paragraphs'],
    },
  },
  {
    name: 'send_audio_as_user',
    description: '[User Identity] Send an audio message as the logged-in user. Requires audio_key.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID' },
        audio_key: { type: 'string', description: 'Audio key from upload' },
      },
      required: ['chat_id', 'audio_key'],
    },
  },

  // ========== User Identity — Contacts & Info ==========
  {
    name: 'search_contacts',
    description: '[User Identity] Search Feishu users, bots, or group chats by name. Returns IDs.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keyword' } },
      required: ['query'],
    },
  },
  {
    name: 'create_p2p_chat',
    description: '[User Identity] Create or get a P2P (direct message) chat. Returns numeric chat_id.',
    inputSchema: {
      type: 'object',
      properties: { user_id: { type: 'string', description: 'Target user ID from search_contacts' } },
      required: ['user_id'],
    },
  },
  {
    name: 'get_chat_info',
    description: '[Official API + User Identity fallback] Get chat details: name, description, member count, owner. Supports both oc_xxx and numeric chat_id.',
    inputSchema: {
      type: 'object',
      properties: { chat_id: { type: 'string', description: 'Chat ID (oc_xxx or numeric)' } },
      required: ['chat_id'],
    },
  },
  {
    name: 'get_user_info',
    description: '[User Identity] Look up a user\'s display name by user ID.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User ID' },
        chat_id: { type: 'string', description: 'Chat context (optional)' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_login_status',
    description: 'Check cookie session validity and app credentials status. Also refreshes session.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ========== IM — Official API (User Identity via UAT) ==========
  {
    name: 'read_p2p_messages',
    description: '[User UAT] Read P2P (direct message) chat history using user_access_token. Works for chats the bot cannot access. Returns newest messages first by default. Requires OAuth setup.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (numeric from create_p2p_chat, or oc_xxx from list_user_chats). Both formats work.' },
        page_size: { type: 'number', description: 'Messages to fetch (default 20, max 50)' },
        start_time: { type: 'string', description: 'Start timestamp in seconds (optional)' },
        end_time: { type: 'string', description: 'End timestamp in seconds (optional)' },
        sort_type: { type: 'string', enum: ['ByCreateTimeDesc', 'ByCreateTimeAsc'], description: 'Sort order (default: ByCreateTimeDesc = newest first)' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'list_user_chats',
    description: '[User UAT] List group chats the user is in. Note: only returns groups, not P2P. For P2P chats, use search_contacts → create_p2p_chat → read_p2p_messages. Requires OAuth setup.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: { type: 'number', description: 'Items per page (default 20)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
    },
  },

  // ========== IM — Official API (Bot Identity) ==========
  {
    name: 'list_chats',
    description: '[Official API] List all chats the bot has joined. Returns chat_id, name, type.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: { type: 'number', description: 'Items per page (default 20, max 100)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
    },
  },
  {
    name: 'read_messages',
    description: '[Official API + UAT fallback] Read message history from any group. Accepts oc_xxx ID, numeric ID, or chat name (auto-searched). Auto-falls back to UAT for external groups the bot cannot access. Returns newest messages first by default, with sender names resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (oc_xxx), numeric ID, or chat name (auto-searched via bot groups, im.chat.search, and user contacts)' },
        page_size: { type: 'number', description: 'Messages to fetch (default 20, max 50)' },
        start_time: { type: 'string', description: 'Start timestamp in seconds (optional)' },
        end_time: { type: 'string', description: 'End timestamp in seconds (optional)' },
        sort_type: { type: 'string', enum: ['ByCreateTimeDesc', 'ByCreateTimeAsc'], description: 'Sort order (default: ByCreateTimeDesc = newest first)' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'reply_message',
    description: '[Official API] Reply to a specific message by message_id (as bot). Only works for text messages; other types return error 230054.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID to reply to (om_xxx)' },
        text: { type: 'string', description: 'Reply text' },
      },
      required: ['message_id', 'text'],
    },
  },
  {
    name: 'forward_message',
    description: '[Official API] Forward a message to another chat.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID to forward' },
        receive_id: { type: 'string', description: 'Target chat_id or open_id' },
      },
      required: ['message_id', 'receive_id'],
    },
  },

  // ========== Docs — Official API ==========
  {
    name: 'search_docs',
    description: '[Official API] Search Feishu documents by keyword.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keyword' } },
      required: ['query'],
    },
  },
  {
    name: 'read_doc',
    description: '[Official API] Read the raw text content of a Feishu document.',
    inputSchema: {
      type: 'object',
      properties: { document_id: { type: 'string', description: 'Document ID or token' } },
      required: ['document_id'],
    },
  },
  {
    name: 'get_doc_blocks',
    description: '[Official API] Get structured block tree of a document. Returns block types, content, and hierarchy for precise document analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Document ID (from search_docs or create_doc)' },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'create_doc',
    description: '[Official API] Create a new Feishu document.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        folder_id: { type: 'string', description: 'Parent folder token (optional)' },
      },
      required: ['title'],
    },
  },

  // ========== Bitable — Official API ==========
  {
    name: 'create_bitable',
    description: '[Official API] Create a new Bitable (multi-dimensional table) app.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Bitable app name' },
        folder_id: { type: 'string', description: 'Parent folder token (optional, defaults to root)' },
      },
    },
  },
  {
    name: 'list_bitable_tables',
    description: '[Official API] List all tables in a Bitable app.',
    inputSchema: {
      type: 'object',
      properties: { app_token: { type: 'string', description: 'Bitable app token' } },
      required: ['app_token'],
    },
  },
  {
    name: 'create_bitable_table',
    description: '[Official API] Create a new data table in a Bitable app. Optionally define initial fields.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        name: { type: 'string', description: 'Table name' },
        fields: {
          type: 'array',
          description: 'Initial field definitions (optional). Each item: {field_name, type} where type is 1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=URL, 17=Attachment, 18=Link, 20=Formula, 21=DuplexLink, 22=Location, 23=GroupChat, 1001=CreateTime, 1002=ModifiedTime, 1003=Creator, 1004=Modifier',
          items: { type: 'object' },
        },
      },
      required: ['app_token', 'name'],
    },
  },
  {
    name: 'list_bitable_fields',
    description: '[Official API] List all fields (columns) in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
      },
      required: ['app_token', 'table_id'],
    },
  },
  {
    name: 'create_bitable_field',
    description: '[Official API] Create a new field (column) in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        field_name: { type: 'string', description: 'Field display name' },
        type: { type: 'number', description: 'Field type: 1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=URL, 17=Attachment, 18=Link, 20=Formula, 21=DuplexLink, 22=Location, 23=GroupChat, 1001=CreateTime, 1002=ModifiedTime, 1003=Creator, 1004=Modifier' },
        property: { type: 'object', description: 'Field-type-specific properties (optional). E.g. for SingleSelect: {options: [{name:"A"},{name:"B"}]}' },
      },
      required: ['app_token', 'table_id', 'field_name', 'type'],
    },
  },
  {
    name: 'update_bitable_field',
    description: '[Official API] Update an existing field (column) in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        field_id: { type: 'string', description: 'Field ID to update' },
        field_name: { type: 'string', description: 'New field name (optional)' },
        type: { type: 'number', description: 'Field type (REQUIRED by Feishu API, see create_bitable_field for values)' },
        property: { type: 'object', description: 'Field-type-specific properties (optional)' },
      },
      required: ['app_token', 'table_id', 'field_id', 'type'],
    },
  },
  {
    name: 'delete_bitable_field',
    description: '[Official API] Delete a field (column) from a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        field_id: { type: 'string', description: 'Field ID to delete' },
      },
      required: ['app_token', 'table_id', 'field_id'],
    },
  },
  {
    name: 'list_bitable_views',
    description: '[Official API] List all views in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
      },
      required: ['app_token', 'table_id'],
    },
  },
  {
    name: 'search_bitable_records',
    description: '[Official API] Search/query records in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        filter: { type: 'object', description: 'Filter conditions (optional)' },
        sort: { type: 'array', description: 'Sort conditions (optional)' },
        page_size: { type: 'number', description: 'Results per page (default 20)' },
      },
      required: ['app_token', 'table_id'],
    },
  },
  {
    name: 'batch_create_bitable_records',
    description: '[Official API] Create one or more records (rows) in a Bitable table. Pass a single record or up to 500.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        records: { type: 'array', description: 'Array of {fields: {field_name: value}} objects', items: { type: 'object' } },
      },
      required: ['app_token', 'table_id', 'records'],
    },
  },
  {
    name: 'batch_update_bitable_records',
    description: '[Official API] Update one or more records in a Bitable table. Pass a single record or up to 500.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        records: { type: 'array', description: 'Array of {record_id, fields: {field_name: value}} objects', items: { type: 'object' } },
      },
      required: ['app_token', 'table_id', 'records'],
    },
  },
  {
    name: 'batch_delete_bitable_records',
    description: '[Official API] Delete one or more records from a Bitable table. Pass a single ID or up to 500.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        record_ids: { type: 'array', description: 'Array of record IDs to delete', items: { type: 'string' } },
      },
      required: ['app_token', 'table_id', 'record_ids'],
    },
  },

  // ========== Wiki — Official API ==========
  {
    name: 'list_wiki_spaces',
    description: '[Official API] List all accessible Wiki spaces.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_wiki',
    description: '[Official API] Search Wiki nodes by keyword.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keyword' } },
      required: ['query'],
    },
  },
  {
    name: 'list_wiki_nodes',
    description: '[Official API] List nodes in a Wiki space.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Wiki space ID' },
        parent_node_token: { type: 'string', description: 'Parent node token (optional)' },
      },
      required: ['space_id'],
    },
  },

  // ========== Drive — Official API ==========
  {
    name: 'list_files',
    description: '[Official API] List files in a Drive folder.',
    inputSchema: {
      type: 'object',
      properties: { folder_token: { type: 'string', description: 'Folder token (empty for root)' } },
    },
  },
  {
    name: 'create_folder',
    description: '[Official API] Create a new folder in Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parent_token: { type: 'string', description: 'Parent folder token (optional)' },
      },
      required: ['name'],
    },
  },

  // ========== Upload — Official API ==========
  {
    name: 'upload_image',
    description: '[Official API] Upload an image file to Feishu. Returns image_key for use with send_image_as_user.',
    inputSchema: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: 'Absolute path to the image file on disk' },
        image_type: { type: 'string', enum: ['message', 'avatar'], description: 'Image usage type (default: message)' },
      },
      required: ['image_path'],
    },
  },
  {
    name: 'upload_file',
    description: '[Official API] Upload a file to Feishu. Returns file_key for use with send_file_as_user.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file on disk' },
        file_type: { type: 'string', enum: ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'], description: 'File type (default: stream for generic files)' },
        file_name: { type: 'string', description: 'Display file name (optional, defaults to basename)' },
      },
      required: ['file_path'],
    },
  },

  // ========== Contact — Official API ==========
  {
    name: 'find_user',
    description: '[Official API] Find a Feishu user by email or mobile number.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'User email (optional)' },
        mobile: { type: 'string', description: 'User mobile with country code like +86xxx (optional)' },
      },
    },
  },

  // ========== IM — Bot Send / Edit / Delete ==========
  {
    name: 'send_message_as_bot',
    description: '[Official API] Send a message as the bot to any chat. Supports text, post, interactive, etc. This is the reliable path for @-mentions: include `<at user_id="ou_xxx">Name</at>` inline in text content and Feishu resolves it to a real @-notification.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat_id (oc_xxx) or open_id' },
        msg_type: { type: 'string', description: 'Message type: text, post, image, interactive, etc.', enum: ['text', 'post', 'image', 'interactive', 'share_chat', 'share_user', 'audio', 'media', 'file', 'sticker'] },
        content: { description: 'Message content (string or object, auto-serialized). Plain text: {"text":"hello"}. Text with @-mention: {"text":"<at user_id=\\"ou_xxx\\">Alice</at> hi"} — the inline tag becomes a real @-notification.' },
      },
      required: ['chat_id', 'msg_type', 'content'],
    },
  },
  {
    name: 'delete_message',
    description: '[Official API] Recall/delete a message (bot can only delete its own messages).',
    inputSchema: {
      type: 'object',
      properties: { message_id: { type: 'string', description: 'Message ID (om_xxx)' } },
      required: ['message_id'],
    },
  },
  {
    name: 'update_message',
    description: '[Official API] Edit a sent message (bot can only edit its own messages). Supports text and post.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID (om_xxx)' },
        msg_type: { type: 'string', description: 'Message type: text or post' },
        content: { description: 'New content. For text: {"text":"updated text"}' },
      },
      required: ['message_id', 'msg_type', 'content'],
    },
  },

  // ========== IM — Reactions ==========
  {
    name: 'add_reaction',
    description: '[Official API] Add an emoji reaction to a message.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID (om_xxx)' },
        emoji_type: { type: 'string', description: 'Emoji type string, e.g. "THUMBSUP", "SMILE", "HEART"' },
      },
      required: ['message_id', 'emoji_type'],
    },
  },
  {
    name: 'delete_reaction',
    description: '[Official API] Remove an emoji reaction from a message.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID' },
        reaction_id: { type: 'string', description: 'Reaction ID (from add_reaction response)' },
      },
      required: ['message_id', 'reaction_id'],
    },
  },

  // ========== IM — Pin Messages ==========
  {
    name: 'pin_message',
    description: '[Official API] Pin or unpin a message in a chat.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID' },
        pinned: { type: 'boolean', description: 'true to pin, false to unpin', default: true },
      },
      required: ['message_id'],
    },
  },

  // ========== IM — Chat Management ==========
  {
    name: 'create_group',
    description: '[Official API] Create a new group chat (as bot). Can add initial members.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Group name' },
        description: { type: 'string', description: 'Group description (optional)' },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'Initial member open_ids (optional)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_group',
    description: '[Official API] Update group chat name or description.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (oc_xxx)' },
        name: { type: 'string', description: 'New group name (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'list_members',
    description: '[Official API] List all members in a group chat.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (oc_xxx)' },
        page_size: { type: 'number', description: 'Items per page (default 50)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'manage_members',
    description: '[Official API] Add or remove members from a group chat.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Group chat ID (oc_xxx)' },
        member_ids: { type: 'array', items: { type: 'string' }, description: 'Array of user open_ids' },
        action: { type: 'string', enum: ['add', 'remove'], description: 'Action to perform' },
      },
      required: ['chat_id', 'member_ids', 'action'],
    },
  },

  // ========== Docs — Block Editing ==========
  {
    name: 'create_doc_block',
    description: '[Official API] Insert content blocks into a document. Add text, headings, lists, etc. after create_doc.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Document ID' },
        parent_block_id: { type: 'string', description: 'Parent block ID (use document_id for root)' },
        children: { type: 'array', description: 'Array of block objects to insert. E.g. [{block_type:2, text:{elements:[{text_run:{content:"Hello"}}]}}]', items: { type: 'object' } },
        index: { type: 'number', description: 'Insert position (optional, appends to end if omitted)' },
      },
      required: ['document_id', 'parent_block_id', 'children'],
    },
  },
  {
    name: 'update_doc_block',
    description: '[Official API] Update a specific block in a document (change text content, style, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Document ID' },
        block_id: { type: 'string', description: 'Block ID to update' },
        update_body: { type: 'object', description: 'Update payload. E.g. {update_text_elements:{elements:[{text_run:{content:"new text"}}]}}' },
      },
      required: ['document_id', 'block_id', 'update_body'],
    },
  },
  {
    name: 'delete_doc_blocks',
    description: '[Official API] Delete a range of blocks from a document.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Document ID' },
        parent_block_id: { type: 'string', description: 'Parent block ID containing the blocks to delete' },
        start_index: { type: 'number', description: 'Start index (inclusive)' },
        end_index: { type: 'number', description: 'End index (exclusive)' },
      },
      required: ['document_id', 'parent_block_id', 'start_index', 'end_index'],
    },
  },

  // ========== Bitable — Additional ==========
  {
    name: 'get_bitable_record',
    description: '[Official API] Get a single record by ID from a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        record_id: { type: 'string', description: 'Record ID' },
      },
      required: ['app_token', 'table_id', 'record_id'],
    },
  },
  {
    name: 'delete_bitable_table',
    description: '[Official API] Delete a data table from a Bitable app.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID to delete' },
      },
      required: ['app_token', 'table_id'],
    },
  },

  {
    name: 'get_bitable_meta',
    description: '[Official API] Get metadata of a Bitable app (name, revision, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
      },
      required: ['app_token'],
    },
  },
  {
    name: 'update_bitable_table',
    description: '[Official API] Rename a data table in a Bitable app.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        name: { type: 'string', description: 'New table name' },
      },
      required: ['app_token', 'table_id', 'name'],
    },
  },
  {
    name: 'create_bitable_view',
    description: '[Official API] Create a new view in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        view_name: { type: 'string', description: 'View name' },
        view_type: { type: 'string', description: 'View type: grid (default), kanban, gallery, form, gantt, calendar', default: 'grid' },
      },
      required: ['app_token', 'table_id', 'view_name'],
    },
  },
  {
    name: 'delete_bitable_view',
    description: '[Official API] Delete a view from a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        view_id: { type: 'string', description: 'View ID to delete' },
      },
      required: ['app_token', 'table_id', 'view_id'],
    },
  },
  {
    name: 'copy_bitable',
    description: '[Official API] Copy a Bitable app to create a new one.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token to copy' },
        name: { type: 'string', description: 'New Bitable name' },
        folder_id: { type: 'string', description: 'Destination folder token (optional)' },
      },
      required: ['app_token', 'name'],
    },
  },

  // ========== Drive — File Operations ==========
  {
    name: 'copy_file',
    description: '[Official API] Copy a file/doc in Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        file_token: { type: 'string', description: 'File token to copy' },
        name: { type: 'string', description: 'New file name' },
        folder_token: { type: 'string', description: 'Destination folder token (optional)' },
        type: { type: 'string', description: 'File type: file, doc, sheet, bitable, docx, mindnote, slides (optional)' },
      },
      required: ['file_token', 'name'],
    },
  },
  {
    name: 'move_file',
    description: '[Official API] Move a file to another folder in Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        file_token: { type: 'string', description: 'File token to move' },
        folder_token: { type: 'string', description: 'Destination folder token' },
      },
      required: ['file_token', 'folder_token'],
    },
  },
  {
    name: 'delete_file',
    description: '[Official API] Delete a file/folder from Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        file_token: { type: 'string', description: 'File token to delete' },
        type: { type: 'string', description: 'Type: file, folder, doc, sheet, bitable, docx, mindnote, slides' },
      },
      required: ['file_token'],
    },
  },

];

// --- Server ---

const server = new Server(
  { name: 'feishu-user-plugin', version: require('../package.json').version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    return await handleTool(name, args || {});
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const json = (o) => text(JSON.stringify(o, null, 2));
const sendResult = (r, desc) => text(r.success ? desc : `Send failed (status: ${r.status})`);

async function handleTool(name, args) {

  switch (name) {
    // --- User Identity: Text Messaging ---

    case 'send_as_user': {
      const c = await getUserClient();
      const r = await c.sendMessage(args.chat_id, args.text, { rootId: args.root_id, parentId: args.parent_id, ats: args.ats });
      return sendResult(r, `Text sent as user to ${args.chat_id}`);
    }
    case 'send_to_user': {
      const c = await getUserClient();
      const results = await c.search(args.user_name);
      const users = results.filter(r => r.type === 'user');
      if (users.length === 0) return text(`User "${args.user_name}" not found. Results: ${JSON.stringify(results)}`);
      if (users.length > 1) {
        const candidates = users.slice(0, 5).map(u => `  - ${u.title} (ID: ${u.id})`).join('\n');
        return text(`Multiple users match "${args.user_name}":\n${candidates}\nUse search_contacts to find the exact user, then create_p2p_chat + send_as_user.`);
      }
      const user = users[0];
      const chatId = await c.createChat(user.id);
      if (!chatId) return text(`Failed to create chat with ${user.title}`);
      const r = await c.sendMessage(chatId, args.text, { ats: args.ats });
      return sendResult(r, `Text sent to ${user.title} (chat: ${chatId})`);
    }
    case 'send_to_group': {
      const c = await getUserClient();
      const results = await c.search(args.group_name);
      const groups = results.filter(r => r.type === 'group');
      if (groups.length === 0) return text(`Group "${args.group_name}" not found. Results: ${JSON.stringify(results)}`);
      if (groups.length > 1) {
        const candidates = groups.slice(0, 5).map(g => `  - ${g.title} (ID: ${g.id})`).join('\n');
        return text(`Multiple groups match "${args.group_name}":\n${candidates}\nUse search_contacts to find the exact group, then send_as_user with the ID.`);
      }
      const group = groups[0];
      const r = await c.sendMessage(group.id, args.text, { ats: args.ats });
      return sendResult(r, `Text sent to group "${group.title}" (${group.id})`);
    }

    // --- User Identity: Rich Message Types ---

    case 'send_image_as_user': {
      const c = await getUserClient();
      const r = await c.sendImage(args.chat_id, args.image_key, { rootId: args.root_id });
      return sendResult(r, `Image sent to ${args.chat_id}`);
    }
    case 'send_file_as_user': {
      const c = await getUserClient();
      const r = await c.sendFile(args.chat_id, args.file_key, args.file_name, { rootId: args.root_id });
      return sendResult(r, `File "${args.file_name}" sent to ${args.chat_id}`);
    }
    case 'send_sticker_as_user': {
      const c = await getUserClient();
      const r = await c.sendSticker(args.chat_id, args.sticker_id, args.sticker_set_id);
      return sendResult(r, `Sticker sent to ${args.chat_id}`);
    }
    case 'send_post_as_user': {
      const c = await getUserClient();
      const r = await c.sendPost(args.chat_id, args.title || '', args.paragraphs, { rootId: args.root_id });
      return sendResult(r, `Post sent to ${args.chat_id}`);
    }
    case 'send_audio_as_user': {
      const c = await getUserClient();
      const r = await c.sendAudio(args.chat_id, args.audio_key);
      return sendResult(r, `Audio sent to ${args.chat_id}`);
    }

    // --- User Identity: Contacts & Info ---

    case 'search_contacts': {
      const c = await getUserClient();
      return json(await c.search(args.query));
    }
    case 'create_p2p_chat': {
      const c = await getUserClient();
      const chatId = await c.createChat(args.user_id);
      return text(chatId ? `P2P chat: ${chatId}` : 'Failed to create P2P chat');
    }
    case 'get_chat_info': {
      // Strategy 1: Official API im.chat.get (supports oc_xxx format)
      if (args.chat_id.startsWith('oc_')) {
        try {
          const info = await getOfficialClient().getChatInfo(args.chat_id);
          return info ? json(info) : text(`No info for chat ${args.chat_id}`);
        } catch (e) {
          console.error(`[feishu-user-plugin] Official getChatInfo failed: ${e.message}`);
        }
      }
      // Strategy 2: Protobuf gateway (supports numeric chat_id)
      try {
        const c = await getUserClient();
        const info = await c.getGroupInfo(args.chat_id);
        if (info) return json(info);
      } catch (e) {
        console.error(`[feishu-user-plugin] Protobuf getChatInfo failed: ${e.message}`);
      }
      return text(`No info for chat ${args.chat_id}`);
    }
    case 'get_user_info': {
      let n = null;
      // Strategy 1: Official API contact lookup (works for same-tenant users by open_id)
      try {
        const official = getOfficialClient();
        n = await official.getUserById(args.user_id, 'open_id');
      } catch {}
      // Strategy 2: User identity client cache (populated by previous search/init calls)
      if (!n) {
        try {
          const c = await getUserClient();
          n = await c.getUserName(args.user_id);
        } catch {}
      }
      return text(n ? `User ${args.user_id}: ${n}` : `Could not resolve user ${args.user_id}. This user may be from an external tenant. Try search_contacts with the user's display name instead.`);
    }
    case 'get_login_status': {
      const parts = [];
      try {
        const c = await getUserClient();
        const status = await c.checkSession();
        parts.push(`Cookie: ${status.valid ? 'Active' : 'Expired'} (${status.userName || status.userId || 'unknown'})`);
        parts.push(`  ${status.message}`);
      } catch (e) { parts.push(`Cookie: ${e.message}`); }
      const hasApp = !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);
      parts.push(`App credentials: ${hasApp ? 'Configured' : 'Not set'}`);
      const official = hasApp ? getOfficialClient() : null;
      parts.push(`User access token: ${official?.hasUAT ? 'Configured (P2P reading enabled)' : 'Not set (optional — needed for P2P chat reading. Run OAuth flow to obtain, see README for details)'}`);
      return text(parts.join('\n'));
    }

    // --- User UAT: IM ---

    case 'read_p2p_messages': {
      const official = getOfficialClient();
      let chatId = args.chat_id;
      let uc = null;
      let ucError = null;
      try { uc = await getUserClient(); } catch (e) { ucError = e; }
      // If chat_id is not numeric or oc_, try to resolve as user name → P2P chat
      if (!/^\d+$/.test(chatId) && !chatId.startsWith('oc_')) {
        if (uc) {
          const results = await uc.search(chatId);
          const user = results.find(r => r.type === 'user');
          if (user) {
            const pChatId = await uc.createChat(String(user.id));
            if (pChatId) chatId = String(pChatId);
            else return text(`Found user "${user.title}" but failed to create P2P chat.`);
          } else {
            // Maybe it's a group name
            const group = results.find(r => r.type === 'group');
            if (group) chatId = String(group.id);
            else return text(`Cannot resolve "${args.chat_id}" to a chat. Use search_contacts to find the ID first.`);
          }
        } else {
          const hint = ucError ? `Cookie auth failed: ${ucError.message}. Fix LARK_COOKIE first, or p` : 'P';
          return text(`"${args.chat_id}" is not a valid chat ID. ${hint}rovide a numeric ID or oc_xxx format. Use search_contacts + create_p2p_chat to get the ID.`);
        }
      }
      return json(await official.readMessagesAsUser(chatId, {
        pageSize: args.page_size, startTime: args.start_time, endTime: args.end_time,
        sortType: args.sort_type,
      }, uc));
    }
    case 'list_user_chats':
      return json(await getOfficialClient().listChatsAsUser({ pageSize: args.page_size, pageToken: args.page_token }));

    // --- Official API: IM ---

    case 'list_chats':
      return json(await getOfficialClient().listChats({ pageSize: args.page_size, pageToken: args.page_token }));
    case 'read_messages': {
      const official = getOfficialClient();
      const msgOpts = { pageSize: args.page_size, startTime: args.start_time, endTime: args.end_time, sortType: args.sort_type };
      // Get userClient for name resolution fallback (best-effort)
      let uc = null;
      try { uc = await getUserClient(); } catch (_) {}
      const resolvedChatId = await chatIdMapper.resolveToOcId(args.chat_id, official);

      // Try bot API first if we resolved an oc_ ID
      if (resolvedChatId) {
        try {
          return json(await official.readMessages(resolvedChatId, msgOpts, uc));
        } catch (botErr) {
          // Bot API failed (e.g. bot not in group, no permission) — fall through to UAT
          console.error(`[feishu-user-plugin] read_messages bot API failed for ${resolvedChatId}: ${botErr.message}`);
          if (official.hasUAT) {
            try {
              return json(await official.readMessagesAsUser(resolvedChatId, msgOpts, uc));
            } catch (uatErr) {
              console.error(`[feishu-user-plugin] read_messages UAT fallback also failed for ${resolvedChatId}: ${uatErr.message}`);
            }
          }
          throw botErr; // Re-throw original error if UAT also failed
        }
      }

      // Bot couldn't resolve the chat name — try search_contacts + UAT for external groups
      if (official.hasUAT) {
        if (!uc) try { uc = await getUserClient(); } catch (_) {}
        const contactChatId = await chatIdMapper.resolveViaContacts(args.chat_id, uc);
        if (contactChatId) {
          return json(await official.readMessagesAsUser(contactChatId, msgOpts, uc));
        }
      }

      return text(`Cannot resolve "${args.chat_id}" to a chat ID.\nSearched: bot's group list, im.chat.search API, and user contacts (search_contacts).\nTry: provide the oc_xxx or numeric chat ID directly.`);
    }
    case 'reply_message':
      return text(`Reply sent: ${(await getOfficialClient().replyMessage(args.message_id, args.text)).messageId}`);
    case 'forward_message':
      return text(`Forwarded: ${(await getOfficialClient().forwardMessage(args.message_id, args.receive_id)).messageId}`);

    // --- Official API: Docs ---

    case 'search_docs':
      return json(await getOfficialClient().searchDocs(args.query));
    case 'read_doc':
      return json(await getOfficialClient().readDoc(args.document_id));
    case 'get_doc_blocks':
      return json(await getOfficialClient().getDocBlocks(args.document_id));
    case 'create_doc': {
      const official = getOfficialClient();
      const ownership = official.hasUAT ? ' (as user)' : '';
      return text(`Document created${ownership}: ${(await official.createDoc(args.title, args.folder_id)).documentId}`);
    }

    // --- Official API: Bitable ---

    case 'create_bitable': {
      const official = getOfficialClient();
      const ownership = official.hasUAT ? ' (as user)' : '';
      const r = await official.createBitable(args.name, args.folder_id);
      return text(`Bitable created${ownership}: ${r.appToken}\nURL: ${r.url || ''}`);
    }
    case 'list_bitable_tables':
      return json(await getOfficialClient().listBitableTables(args.app_token));
    case 'create_bitable_table':
      return text(`Table created: ${(await getOfficialClient().createBitableTable(args.app_token, args.name, args.fields)).tableId}`);
    case 'list_bitable_fields':
      return json(await getOfficialClient().listBitableFields(args.app_token, args.table_id));
    case 'create_bitable_field': {
      const config = { field_name: args.field_name, type: args.type };
      if (args.property) config.property = args.property;
      return json(await getOfficialClient().createBitableField(args.app_token, args.table_id, config));
    }
    case 'update_bitable_field': {
      const config = {};
      if (args.field_name) config.field_name = args.field_name;
      if (args.type) config.type = args.type;
      if (args.property) config.property = args.property;
      return json(await getOfficialClient().updateBitableField(args.app_token, args.table_id, args.field_id, config));
    }
    case 'delete_bitable_field': {
      const r = await getOfficialClient().deleteBitableField(args.app_token, args.table_id, args.field_id);
      return text(r.deleted ? `Field ${r.fieldId} deleted` : `Field deletion returned deleted=${r.deleted}`);
    }
    case 'list_bitable_views':
      return json(await getOfficialClient().listBitableViews(args.app_token, args.table_id));
    case 'search_bitable_records':
      return json(await getOfficialClient().searchBitableRecords(args.app_token, args.table_id, {
        filter: args.filter, sort: args.sort, pageSize: args.page_size,
      }));
    case 'batch_create_bitable_records':
      return json(await getOfficialClient().batchCreateBitableRecords(args.app_token, args.table_id, args.records));
    case 'batch_update_bitable_records':
      return json(await getOfficialClient().batchUpdateBitableRecords(args.app_token, args.table_id, args.records));
    case 'batch_delete_bitable_records':
      return json(await getOfficialClient().batchDeleteBitableRecords(args.app_token, args.table_id, args.record_ids));

    // --- Official API: Wiki ---

    case 'list_wiki_spaces':
      return json(await getOfficialClient().listWikiSpaces());
    case 'search_wiki':
      return json(await getOfficialClient().searchWiki(args.query));
    case 'list_wiki_nodes':
      return json(await getOfficialClient().listWikiNodes(args.space_id, { parentNodeToken: args.parent_node_token }));

    // --- Official API: Drive ---

    case 'list_files':
      return json(await getOfficialClient().listFiles(args.folder_token));
    case 'create_folder': {
      const official = getOfficialClient();
      const ownership = official.hasUAT ? ' (as user)' : '';
      return text(`Folder created${ownership}: ${(await official.createFolder(args.name, args.parent_token)).token}`);
    }

    // --- Official API: Contact ---

    case 'find_user':
      return json(await getOfficialClient().findUserByIdentity({ emails: args.email, mobiles: args.mobile }));

    // --- Upload ---

    case 'upload_image': {
      const r = await getOfficialClient().uploadImage(args.image_path, args.image_type);
      return text(`Image uploaded: ${r.imageKey}\nUse this image_key with send_image_as_user to send it.`);
    }
    case 'upload_file': {
      const r = await getOfficialClient().uploadFile(args.file_path, args.file_type, args.file_name);
      return text(`File uploaded: ${r.fileKey}\nUse this file_key with send_file_as_user to send it.`);
    }

    // --- Official API: Bot Send / Edit / Delete ---

    case 'send_message_as_bot': {
      const r = await getOfficialClient().sendMessageAsBot(args.chat_id, args.msg_type, args.content);
      return text(`Message sent (bot): ${r.messageId}`);
    }
    case 'delete_message':
      return text(`Message deleted: ${(await getOfficialClient().deleteMessage(args.message_id)).deleted}`);
    case 'update_message':
      return text(`Message updated: ${(await getOfficialClient().updateMessage(args.message_id, args.msg_type, args.content)).messageId}`);

    // --- Official API: Reactions ---

    case 'add_reaction':
      return text(`Reaction added: ${(await getOfficialClient().addReaction(args.message_id, args.emoji_type)).reactionId}`);
    case 'delete_reaction':
      return text(`Reaction removed: ${(await getOfficialClient().deleteReaction(args.message_id, args.reaction_id)).deleted}`);

    // --- Official API: Pins ---

    case 'pin_message':
      return json(await getOfficialClient().pinMessage(args.message_id, args.pinned !== false));

    // --- Official API: Chat Management ---

    case 'create_group':
      return text(`Group created: ${(await getOfficialClient().createChat({ name: args.name, description: args.description, userIds: args.user_ids })).chatId}`);
    case 'update_group':
      return text(`Group updated: ${(await getOfficialClient().updateChat(args.chat_id, { name: args.name, description: args.description })).updated}`);
    case 'list_members':
      return json(await getOfficialClient().listChatMembers(args.chat_id, { pageSize: args.page_size, pageToken: args.page_token }));
    case 'manage_members': {
      const official = getOfficialClient();
      if (args.action === 'remove') {
        return json(await official.removeChatMembers(args.chat_id, args.member_ids));
      }
      return json(await official.addChatMembers(args.chat_id, args.member_ids));
    }

    // --- Official API: Doc Block Editing ---

    case 'create_doc_block':
      return json(await getOfficialClient().createDocBlock(args.document_id, args.parent_block_id, args.children, args.index));
    case 'update_doc_block':
      return json(await getOfficialClient().updateDocBlock(args.document_id, args.block_id, args.update_body));
    case 'delete_doc_blocks':
      return text(`Blocks deleted: ${(await getOfficialClient().deleteDocBlocks(args.document_id, args.parent_block_id, args.start_index, args.end_index)).deleted}`);

    // --- Official API: Bitable Additional ---

    case 'get_bitable_record':
      return json(await getOfficialClient().getBitableRecord(args.app_token, args.table_id, args.record_id));
    case 'delete_bitable_table':
      return text(`Table deleted: ${(await getOfficialClient().deleteBitableTable(args.app_token, args.table_id)).deleted}`);
    case 'get_bitable_meta':
      return json(await getOfficialClient().getBitableMeta(args.app_token));
    case 'update_bitable_table':
      return text(`Table renamed: ${(await getOfficialClient().updateBitableTable(args.app_token, args.table_id, args.name)).name}`);
    case 'create_bitable_view':
      return json(await getOfficialClient().createBitableView(args.app_token, args.table_id, args.view_name, args.view_type));
    case 'delete_bitable_view':
      return text(`View deleted: ${(await getOfficialClient().deleteBitableView(args.app_token, args.table_id, args.view_id)).deleted}`);
    case 'copy_bitable':
      return json(await getOfficialClient().copyBitable(args.app_token, args.name, args.folder_id));

    // --- Official API: Drive File Operations ---

    case 'copy_file':
      return json(await getOfficialClient().copyFile(args.file_token, args.name, args.folder_token, args.type));
    case 'move_file':
      return text(`File moved: task=${(await getOfficialClient().moveFile(args.file_token, args.folder_token)).taskId}`);
    case 'delete_file':
      return text(`File deleted: task=${(await getOfficialClient().deleteFile(args.file_token, args.type)).taskId}`);

    default:
      return text(`Unknown tool: ${name}`);
  }
}

// --- Process-level error handlers ---
// Prevent stray promise rejections or uncaught exceptions from killing the MCP server.
process.on('uncaughtException', (err) => {
  console.error('[feishu-user-plugin] Uncaught exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[feishu-user-plugin] Unhandled rejection:', reason);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Startup diagnostics
  const hasCookie = !!process.env.LARK_COOKIE;
  const hasApp = !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);
  const hasUAT = !!process.env.LARK_USER_ACCESS_TOKEN;
  console.error(`[feishu-user-plugin] MCP Server v${require('../package.json').version} — ${TOOLS.length} tools`);
  console.error(`[feishu-user-plugin] Auth: Cookie=${hasCookie ? 'YES' : 'NO'} App=${hasApp ? 'YES' : 'NO'} UAT=${hasUAT ? 'YES' : 'NO'}`);
  if (!hasCookie) console.error('[feishu-user-plugin] WARNING: LARK_COOKIE not set — user identity tools (send_to_user, etc.) will fail');
  if (!hasApp) console.error('[feishu-user-plugin] WARNING: LARK_APP_ID/SECRET not set — official API tools (read_messages, docs, etc.) will fail');
  if (!hasUAT) console.error('[feishu-user-plugin] WARNING: LARK_USER_ACCESS_TOKEN not set — P2P chat reading (read_p2p_messages) will fail');
}

main().catch(console.error);
