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

// --- Client Singletons ---

let userClient = null;
let officialClient = null;

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
  if (!appId || !appSecret) throw new Error('LARK_APP_ID and LARK_APP_SECRET not set. Required for docs/tables/wiki operations.');
  officialClient = new LarkOfficialClient(appId, appSecret);
  return officialClient;
}

// --- Tool Definitions ---

const TOOLS = [
  // ========== User Identity (reverse-engineered) ==========
  {
    name: 'send_as_user',
    description: '[User Identity] Send a message as the logged-in Feishu user (not a bot). Messages appear from YOUR personal account.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID. Get from search_contacts or create_p2p_chat.' },
        text: { type: 'string', description: 'Message text to send' },
      },
      required: ['chat_id', 'text'],
    },
  },
  {
    name: 'send_to_user',
    description: '[User Identity] Search user by name → create P2P chat → send message. All in one step.',
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
    description: '[User Identity] Search group by name → send message. All in one step.',
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
    name: 'search_contacts',
    description: '[User Identity] Search Feishu users, bots, or group chats by name. Returns IDs for other tools.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keyword' } },
      required: ['query'],
    },
  },
  {
    name: 'create_p2p_chat',
    description: '[User Identity] Create or get a P2P (direct message) chat. Returns chat_id.',
    inputSchema: {
      type: 'object',
      properties: { user_id: { type: 'string', description: 'Target user ID from search_contacts' } },
      required: ['user_id'],
    },
  },
  {
    name: 'get_chat_info',
    description: '[User Identity] Get chat details: name, description, member count, owner, etc.',
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
    description: 'Check if both cookie session and app credentials are valid.',
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
    description: '[Official API] Read message history from a chat. Returns sender, content, timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (use open chat ID like oc_xxx)' },
        page_size: { type: 'number', description: 'Messages to fetch (default 20, max 50)' },
        start_time: { type: 'string', description: 'Start timestamp in seconds (optional)' },
        end_time: { type: 'string', description: 'End timestamp in seconds (optional)' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'reply_message',
    description: '[Official API] Reply to a specific message by message_id.',
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
    description: '[Official API] Search/query records in a Bitable table with optional filter and sort.',
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
        parent_node_token: { type: 'string', description: 'Parent node token (optional, for sub-nodes)' },
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
      properties: {
        folder_token: { type: 'string', description: 'Folder token (empty for root)' },
      },
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
    description: '[Official API] Find a Feishu user by email or mobile number. Returns open_id.',
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
  { name: 'feishu-user-mcp', version: '0.3.0' },
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

async function handleTool(name, args) {
  const text = (s) => ({ content: [{ type: 'text', text: s }] });
  const json = (o) => text(JSON.stringify(o, null, 2));

  // --- User Identity Tools (cookie-based) ---

  switch (name) {
    case 'send_as_user': {
      const c = await getUserClient();
      const r = await c.sendMessage(args.chat_id, args.text);
      return text(r.success ? `Message sent as user to chat ${args.chat_id}` : `Send failed: ${r.status}`);
    }
    case 'send_to_user': {
      const c = await getUserClient();
      const results = await c.search(args.user_name);
      const user = results.find(r => r.type === 'user');
      if (!user) return text(`User "${args.user_name}" not found. Results: ${JSON.stringify(results)}`);
      const chatId = await c.createChat(user.id);
      if (!chatId) return text(`Failed to create chat with ${user.title}`);
      const r = await c.sendMessage(chatId, args.text);
      return text(r.success ? `Message sent to ${user.title} (chat: ${chatId})` : `Send failed: ${r.status}`);
    }
    case 'send_to_group': {
      const c = await getUserClient();
      const results = await c.search(args.group_name);
      const group = results.find(r => r.type === 'group');
      if (!group) return text(`Group "${args.group_name}" not found. Results: ${JSON.stringify(results)}`);
      const r = await c.sendMessage(group.id, args.text);
      return text(r.success ? `Message sent to group "${group.title}" (${group.id})` : `Send failed: ${r.status}`);
    }
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
        parts.push(`Cookie: Active (${c.userName || c.userId})`);
      } catch (e) { parts.push(`Cookie: ${e.message}`); }
      const hasApp = !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);
      parts.push(`App credentials: ${hasApp ? 'Configured' : 'Not set (docs/tables/wiki unavailable)'}`);
      return text(parts.join('\n'));
    }

    // --- Official API Tools ---

    case 'list_chats':
      return json(await getOfficialClient().listChats({ pageSize: args.page_size, pageToken: args.page_token }));
    case 'read_messages':
      return json(await getOfficialClient().readMessages(args.chat_id, {
        pageSize: args.page_size, startTime: args.start_time, endTime: args.end_time,
      }));
    case 'reply_message': {
      const r = await getOfficialClient().replyMessage(args.message_id, args.text);
      return text(`Reply sent: ${r.messageId}`);
    }
    case 'forward_message': {
      const r = await getOfficialClient().forwardMessage(args.message_id, args.receive_id);
      return text(`Message forwarded: ${r.messageId}`);
    }
    case 'search_docs':
      return json(await getOfficialClient().searchDocs(args.query));
    case 'read_doc':
      return json(await getOfficialClient().readDoc(args.document_id));
    case 'create_doc': {
      const r = await getOfficialClient().createDoc(args.title, args.folder_id);
      return text(`Document created: ${r.documentId}`);
    }
    case 'list_bitable_tables':
      return json(await getOfficialClient().listBitableTables(args.app_token));
    case 'list_bitable_fields':
      return json(await getOfficialClient().listBitableFields(args.app_token, args.table_id));
    case 'search_bitable_records':
      return json(await getOfficialClient().searchBitableRecords(args.app_token, args.table_id, {
        filter: args.filter, sort: args.sort, pageSize: args.page_size,
      }));
    case 'create_bitable_record': {
      const r = await getOfficialClient().createBitableRecord(args.app_token, args.table_id, args.fields);
      return text(`Record created: ${r.recordId}`);
    }
    case 'update_bitable_record': {
      const r = await getOfficialClient().updateBitableRecord(args.app_token, args.table_id, args.record_id, args.fields);
      return text(`Record updated: ${r.recordId}`);
    }
    case 'list_wiki_spaces':
      return json(await getOfficialClient().listWikiSpaces());
    case 'search_wiki':
      return json(await getOfficialClient().searchWiki(args.query));
    case 'list_wiki_nodes':
      return json(await getOfficialClient().listWikiNodes(args.space_id, { parentNodeToken: args.parent_node_token }));
    case 'list_files':
      return json(await getOfficialClient().listFiles(args.folder_token));
    case 'create_folder': {
      const r = await getOfficialClient().createFolder(args.name, args.parent_token);
      return text(`Folder created: ${r.token}`);
    }
    case 'find_user':
      return json(await getOfficialClient().findUserByIdentity({ emails: args.email, mobiles: args.mobile }));
    default:
      return text(`Unknown tool: ${name}`);
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[feishu-user-mcp] MCP Server started — %d tools available', TOOLS.length);
}

main().catch(console.error);
