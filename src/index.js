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

let client = null;

async function getClient() {
  if (client) return client;
  const cookie = process.env.LARK_COOKIE;
  if (!cookie) throw new Error('LARK_COOKIE not set');
  client = new LarkUserClient(cookie);
  await client.init();
  return client;
}

const server = new Server(
  { name: 'feishu-user-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_as_user',
      description: 'Send a message as the logged-in Feishu user (not a bot). Supports P2P and group chats.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'Target chat ID (numeric string)' },
          text: { type: 'string', description: 'Message text to send' },
        },
        required: ['chat_id', 'text'],
      },
    },
    {
      name: 'search_contacts',
      description: 'Search for Feishu users or groups by name. Returns user/group IDs.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword' },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_p2p_chat',
      description: 'Create or get a P2P chat with a user. Returns the chat ID for messaging.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Target user ID (numeric string from search)' },
        },
        required: ['user_id'],
      },
    },
    {
      name: 'send_to_user',
      description: 'Search a user by name, create P2P chat, and send message — all in one step.',
      inputSchema: {
        type: 'object',
        properties: {
          user_name: { type: 'string', description: 'User name to search for' },
          text: { type: 'string', description: 'Message text to send' },
        },
        required: ['user_name', 'text'],
      },
    },
    {
      name: 'get_login_status',
      description: 'Check if the Feishu cookie session is still valid.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

// Call tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const c = await getClient();

    switch (name) {
      case 'send_as_user': {
        const result = await c.sendMessage(args.chat_id, args.text);
        return {
          content: [{ type: 'text', text: result.success
            ? `Message sent as user to chat ${args.chat_id}`
            : `Send failed: status=${result.status}` }],
        };
      }

      case 'search_contacts': {
        const results = await c.search(args.query);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'create_p2p_chat': {
        const chatId = await c.createChat(args.user_id);
        return {
          content: [{ type: 'text', text: chatId
            ? `P2P chat created/found: ${chatId}`
            : 'Failed to create P2P chat' }],
        };
      }

      case 'send_to_user': {
        const results = await c.search(args.user_name);
        const user = results.find((r) => r.type === 'user');
        if (!user) {
          return { content: [{ type: 'text', text: `User "${args.user_name}" not found` }] };
        }
        const chatId = await c.createChat(user.id);
        if (!chatId) {
          return { content: [{ type: 'text', text: `Failed to create chat with user ${user.id}` }] };
        }
        const result = await c.sendMessage(chatId, args.text);
        return {
          content: [{ type: 'text', text: result.success
            ? `Message sent as user to ${user.title} (chat: ${chatId})`
            : `Send failed: status=${result.status}` }],
        };
      }

      case 'get_login_status': {
        return {
          content: [{ type: 'text', text: c.userId
            ? `Session active. User ID: ${c.userId}`
            : 'Session may be expired. Re-login needed.' }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[feishu-user-mcp] MCP Server started on stdio');
}

main().catch(console.error);
