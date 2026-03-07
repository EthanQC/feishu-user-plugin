#!/usr/bin/env node
/**
 * Quick test: send a message as user identity
 * Usage: LARK_COOKIE="..." node src/test-send.js <chatId> <message>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { LarkUserClient } = require('./client');

async function main() {
  const cookie = process.env.LARK_COOKIE;
  if (!cookie) {
    console.error('Set LARK_COOKIE in .env or environment');
    process.exit(1);
  }

  const chatId = process.argv[2];
  const text = process.argv[3] || '[feishu-user-mcp] test message';

  if (!chatId) {
    console.error('Usage: node src/test-send.js <chatId> [message]');
    console.error('  chatId: the numeric chat ID from feishu');
    process.exit(1);
  }

  const client = new LarkUserClient(cookie);
  await client.init();

  console.log(`Sending as user ${client.userId} to chat ${chatId}...`);
  const result = await client.sendMessage(chatId, text);
  console.log('Result:', result);

  // Also test search
  console.log('\nTesting search for "test"...');
  const results = await client.search('test');
  console.log('Search results:', results.slice(0, 5));
}

main().catch(console.error);
