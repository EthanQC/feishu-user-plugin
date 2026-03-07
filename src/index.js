#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
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
      console.error('[feishu-user-mcp] ChatIdMapper refresh failed:', e.message);
    }
  }

  async findByName(name, official) {
    await this._refresh(official);
    // Exact match first
    for (const [ocId, chatName] of this.nameCache) {
      if (chatName === name) return ocId;
    }
    // Partial match
    for (const [ocId, chatName] of this.nameCache) {
      if (chatName && chatName.includes(name)) return ocId;
    }
    return null;
  }

  async resolveToOcId(chatIdOrName, official) {
    if (chatIdOrName.startsWith('oc_')) return chatIdOrName;
    // Try as chat name
    return this.findByName(chatIdOrName, official);
  }
}

// --- Client Singletons ---

let userClient = null;
let officialClient = null;
const chatIdMapper = new ChatIdMapper();

async function getUserClient() {
  if (userClient) return userClient;
  const cookie = process.env.LARK_COOKIE;
  if (!cookie) throw new Error('LARK_COOKIE not set. See README for setup instructions.');
  userClient = new LarkUserClient(cookie);
  await userClient.init();
  return userClient;
}

function getOfficialClient() {
  if (officialClient) return officialClient;
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) throw new Error('LARK_APP_ID and LARK_APP_SECRET not set.');
  officialClient = new LarkOfficialClient(appId, appSecret);
  return officialClient;
}

// --- Tool Definitions ---

const TOOLS = [
  // ========== User Identity — Send Messages ==========
  {
    name: 'send_as_user',
    description: '[User Identity] Send a text message as the logged-in Feishu user. Supports reply threading.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID (numeric)' },
        text: { type: 'string', description: 'Message text' },
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
    description: '[User Identity] Send a rich text (POST) message with title and formatted paragraphs.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID' },
        title: { type: 'string', description: 'Post title (optional)' },
        paragraphs: {
          type: 'array',
          description: 'Array of paragraphs. Each paragraph is an array of elements: {tag:"text",text:"..."} or {tag:"a",href:"...",text:"..."} or {tag:"at",userId:"..."}',
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
    description: '[User Identity] Get chat details: name, description, member count, owner.',
    inputSchema: {
      type: 'object',
      properties: { chat_id: { type: 'string', description: 'Chat ID' } },
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

  // ========== IM — Official API ==========
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
    description: '[Official API] Read message history. Accepts oc_xxx ID or chat name (auto-resolved).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (oc_xxx) or chat name (auto-searched)' },
        page_size: { type: 'number', description: 'Messages to fetch (default 20, max 50)' },
        start_time: { type: 'string', description: 'Start timestamp in seconds (optional)' },
        end_time: { type: 'string', description: 'End timestamp in seconds (optional)' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'reply_message',
    description: '[Official API] Reply to a specific message by message_id (as bot).',
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
    name: 'list_bitable_tables',
    description: '[Official API] List all tables in a Bitable app.',
    inputSchema: {
      type: 'object',
      properties: { app_token: { type: 'string', description: 'Bitable app token' } },
      required: ['app_token'],
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
    name: 'create_bitable_record',
    description: '[Official API] Create a new record (row) in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        fields: { type: 'object', description: 'Field name → value mapping' },
      },
      required: ['app_token', 'table_id', 'fields'],
    },
  },
  {
    name: 'update_bitable_record',
    description: '[Official API] Update an existing record in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        record_id: { type: 'string', description: 'Record ID to update' },
        fields: { type: 'object', description: 'Field name → new value mapping' },
      },
      required: ['app_token', 'table_id', 'record_id', 'fields'],
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
];

// --- Server ---

const server = new Server(
  { name: 'feishu-user-mcp', version: '0.4.0' },
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
      const r = await c.sendMessage(args.chat_id, args.text, { rootId: args.root_id, parentId: args.parent_id });
      return sendResult(r, `Text sent as user to ${args.chat_id}`);
    }
    case 'send_to_user': {
      const c = await getUserClient();
      const results = await c.search(args.user_name);
      const user = results.find(r => r.type === 'user');
      if (!user) return text(`User "${args.user_name}" not found. Results: ${JSON.stringify(results)}`);
      const chatId = await c.createChat(user.id);
      if (!chatId) return text(`Failed to create chat with ${user.title}`);
      const r = await c.sendMessage(chatId, args.text);
      return sendResult(r, `Text sent to ${user.title} (chat: ${chatId})`);
    }
    case 'send_to_group': {
      const c = await getUserClient();
      const results = await c.search(args.group_name);
      const group = results.find(r => r.type === 'group');
      if (!group) return text(`Group "${args.group_name}" not found. Results: ${JSON.stringify(results)}`);
      const r = await c.sendMessage(group.id, args.text);
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
      const c = await getUserClient();
      const info = await c.getGroupInfo(args.chat_id);
      return info ? json(info) : text(`No info for chat ${args.chat_id}`);
    }
    case 'get_user_info': {
      const c = await getUserClient();
      const n = await c.getUserName(args.user_id, args.chat_id || '0');
      return text(n ? `User ${args.user_id}: ${n}` : `Could not resolve user ${args.user_id}`);
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
      return text(parts.join('\n'));
    }

    // --- Official API: IM ---

    case 'list_chats':
      return json(await getOfficialClient().listChats({ pageSize: args.page_size, pageToken: args.page_token }));
    case 'read_messages': {
      const official = getOfficialClient();
      const resolvedChatId = await chatIdMapper.resolveToOcId(args.chat_id, official);
      if (!resolvedChatId) {
        return text(`Cannot resolve "${args.chat_id}" to oc_ ID. Use list_chats to find the correct ID, or provide chat name.`);
      }
      return json(await official.readMessages(resolvedChatId, {
        pageSize: args.page_size, startTime: args.start_time, endTime: args.end_time,
      }));
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
    case 'create_doc':
      return text(`Document created: ${(await getOfficialClient().createDoc(args.title, args.folder_id)).documentId}`);

    // --- Official API: Bitable ---

    case 'list_bitable_tables':
      return json(await getOfficialClient().listBitableTables(args.app_token));
    case 'list_bitable_fields':
      return json(await getOfficialClient().listBitableFields(args.app_token, args.table_id));
    case 'search_bitable_records':
      return json(await getOfficialClient().searchBitableRecords(args.app_token, args.table_id, {
        filter: args.filter, sort: args.sort, pageSize: args.page_size,
      }));
    case 'create_bitable_record':
      return text(`Record created: ${(await getOfficialClient().createBitableRecord(args.app_token, args.table_id, args.fields)).recordId}`);
    case 'update_bitable_record':
      return text(`Record updated: ${(await getOfficialClient().updateBitableRecord(args.app_token, args.table_id, args.record_id, args.fields)).recordId}`);

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
    case 'create_folder':
      return text(`Folder created: ${(await getOfficialClient().createFolder(args.name, args.parent_token)).token}`);

    // --- Official API: Contact ---

    case 'find_user':
      return json(await getOfficialClient().findUserByIdentity({ emails: args.email, mobiles: args.mobile }));

    default:
      return text(`Unknown tool: ${name}`);
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[feishu-user-mcp] MCP Server v0.4.0 — %d tools available', TOOLS.length);
}

main().catch(console.error);
