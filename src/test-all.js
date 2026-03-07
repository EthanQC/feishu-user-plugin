#!/usr/bin/env node
/**
 * Comprehensive test for all feishu-user-mcp tools.
 * Sends test messages to "飞书plugin测试群".
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { LarkUserClient } = require('./client');
const { LarkOfficialClient } = require('./official');

const TEST_GROUP = '飞书plugin测试群';
const results = [];

function log(tool, status, detail = '') {
  const icon = status === 'PASS' ? '✅' : status === 'SKIP' ? '⏭️' : '❌';
  results.push({ tool, status, detail });
  console.log(`${icon} ${tool}: ${status} ${detail}`);
}

async function main() {
  // --- Init clients ---
  let userClient, officialClient;

  // 1. get_login_status — Cookie auth
  try {
    userClient = new LarkUserClient(process.env.LARK_COOKIE);
    await userClient.init();
    log('get_login_status', 'PASS', `user=${userClient.userName || userClient.userId}`);
  } catch (e) {
    log('get_login_status', 'FAIL', e.message);
    console.error('Cookie auth failed, cannot continue user identity tests.');
    return;
  }

  // 2. Official client init
  try {
    officialClient = new LarkOfficialClient(process.env.LARK_APP_ID, process.env.LARK_APP_SECRET);
    officialClient.loadUAT();
    log('official_client_init', 'PASS', `hasUAT=${officialClient.hasUAT}`);
  } catch (e) {
    log('official_client_init', 'FAIL', e.message);
  }

  // ========== User Identity Tests ==========

  // 3. search_contacts — search group
  let groupId = null;
  try {
    const res = await userClient.search(TEST_GROUP);
    const group = res.find(r => r.type === 'group');
    if (group) {
      groupId = group.id;
      log('search_contacts (group)', 'PASS', `found "${group.title}" id=${group.id}`);
    } else {
      log('search_contacts (group)', 'FAIL', `group "${TEST_GROUP}" not found. results: ${JSON.stringify(res)}`);
    }
  } catch (e) {
    log('search_contacts (group)', 'FAIL', e.message);
  }

  // 4. search_contacts — search user
  let testUserId = null;
  try {
    const res = await userClient.search(userClient.userName || '吴坤儒');
    const user = res.find(r => r.type === 'user');
    if (user) {
      testUserId = user.id;
      log('search_contacts (user)', 'PASS', `found "${user.title}" id=${user.id}`);
    } else {
      log('search_contacts (user)', 'FAIL', 'no user found');
    }
  } catch (e) {
    log('search_contacts (user)', 'FAIL', e.message);
  }

  // 5. get_chat_info
  if (groupId) {
    try {
      const info = await userClient.getGroupInfo(groupId);
      if (info && info.name) {
        log('get_chat_info', 'PASS', `name="${info.name}" members=${info.memberCount}`);
      } else {
        log('get_chat_info', 'FAIL', 'no info returned');
      }
    } catch (e) {
      log('get_chat_info', 'FAIL', e.message);
    }
  }

  // 6. get_user_info
  if (testUserId) {
    try {
      const name = await userClient.getUserName(testUserId, '0');
      log('get_user_info', 'PASS', `name="${name}"`);
    } catch (e) {
      log('get_user_info', 'FAIL', e.message);
    }
  }

  // 7. send_as_user (text)
  if (groupId) {
    try {
      const r = await userClient.sendMessage(groupId, '[自动化测试] send_as_user: 文本消息测试');
      log('send_as_user (text)', r.success ? 'PASS' : 'FAIL', `status=${r.status}`);
    } catch (e) {
      log('send_as_user (text)', 'FAIL', e.message);
    }
  }

  // 8. send_to_group
  try {
    const searchRes = await userClient.search(TEST_GROUP);
    const group = searchRes.find(r => r.type === 'group');
    if (group) {
      const r = await userClient.sendMessage(group.id, '[自动化测试] send_to_group: 群消息测试');
      log('send_to_group', r.success ? 'PASS' : 'FAIL', `status=${r.status}`);
    } else {
      log('send_to_group', 'FAIL', 'group not found');
    }
  } catch (e) {
    log('send_to_group', 'FAIL', e.message);
  }

  // 9. send_post_as_user (rich text)
  if (groupId) {
    try {
      const paragraphs = [
        [{ tag: 'text', text: '[自动化测试] send_post_as_user: ' }, { tag: 'text', text: '富文本消息测试' }],
        [{ tag: 'text', text: '第二段落 - ' }, { tag: 'a', href: 'https://example.com', text: '链接测试' }],
      ];
      const r = await userClient.sendPost(groupId, '自动化测试 - 富文本', paragraphs);
      log('send_post_as_user', r.success ? 'PASS' : 'FAIL', `status=${r.status}`);
    } catch (e) {
      log('send_post_as_user', 'FAIL', e.message);
    }
  }

  // 10. send_image_as_user (skip — needs image_key)
  log('send_image_as_user', 'SKIP', 'needs image_key from upload');

  // 11. send_file_as_user (skip — needs file_key)
  log('send_file_as_user', 'SKIP', 'needs file_key from upload');

  // 12. send_sticker_as_user (skip — needs sticker IDs)
  log('send_sticker_as_user', 'SKIP', 'needs sticker_id/sticker_set_id');

  // 13. send_audio_as_user (skip — needs audio_key)
  log('send_audio_as_user', 'SKIP', 'needs audio_key from upload');

  // 14. create_p2p_chat
  if (testUserId) {
    try {
      const chatId = await userClient.createChat(testUserId);
      log('create_p2p_chat', chatId ? 'PASS' : 'FAIL', `chatId=${chatId}`);
    } catch (e) {
      log('create_p2p_chat', 'FAIL', e.message);
    }
  }

  // ========== Official API Tests ==========

  if (!officialClient) {
    log('official_api_tests', 'SKIP', 'no official client');
  } else {

    // 15. list_chats
    let ocChatId = null;
    try {
      const res = await officialClient.listChats({ pageSize: 5 });
      if (res.items && res.items.length > 0) {
        // find test group
        const testChat = res.items.find(c => c.name && c.name.includes('plugin测试'));
        ocChatId = testChat ? testChat.chat_id : res.items[0].chat_id;
        log('list_chats', 'PASS', `found ${res.items.length} chats, using ${ocChatId}`);
      } else {
        log('list_chats', 'FAIL', 'no chats found');
      }
    } catch (e) {
      log('list_chats', 'FAIL', e.message);
    }

    // 16. read_messages
    let testMessageId = null;
    if (ocChatId) {
      try {
        const res = await officialClient.readMessages(ocChatId, { pageSize: 10 });
        // Find a text message to reply to
        const textMsg = res.items.find(m => m.msgType === 'text');
        if (textMsg) testMessageId = textMsg.messageId;
        log('read_messages', 'PASS', `got ${res.items.length} messages, text msg=${testMessageId || 'none'}`);
      } catch (e) {
        log('read_messages', 'FAIL', e.message);
      }
    }

    // 17. reply_message
    if (testMessageId) {
      try {
        const res = await officialClient.replyMessage(testMessageId, '[自动化测试] reply_message: bot回复测试');
        log('reply_message', res.messageId ? 'PASS' : 'FAIL', `messageId=${res.messageId}`);
      } catch (e) {
        log('reply_message', 'FAIL', e.message);
      }
    } else {
      log('reply_message', 'SKIP', 'no text message to reply to');
    }

    // 18. forward_message (skip — would duplicate messages)
    log('forward_message', 'SKIP', 'skipped to avoid duplicate messages');

    // 19. search_docs
    try {
      const res = await officialClient.searchDocs('测试');
      log('search_docs', 'PASS', `found ${(res.items || []).length} docs`);
    } catch (e) {
      log('search_docs', 'FAIL', e.message);
    }

    // 20. read_doc (skip — needs doc ID)
    log('read_doc', 'SKIP', 'needs document_id from search_docs');

    // 21. create_doc (skip — would create real doc)
    log('create_doc', 'SKIP', 'skipped to avoid creating unnecessary docs');

    // 22. list_bitable_tables (skip — needs app_token)
    log('list_bitable_tables', 'SKIP', 'needs bitable app_token');

    // 23. list_bitable_fields (skip)
    log('list_bitable_fields', 'SKIP', 'needs app_token + table_id');

    // 24. search_bitable_records (skip)
    log('search_bitable_records', 'SKIP', 'needs app_token + table_id');

    // 25. create_bitable_record (skip)
    log('create_bitable_record', 'SKIP', 'needs app_token + table_id + fields');

    // 26. update_bitable_record (skip)
    log('update_bitable_record', 'SKIP', 'needs app_token + table_id + record_id');

    // 27. list_wiki_spaces
    try {
      const res = await officialClient.listWikiSpaces();
      log('list_wiki_spaces', 'PASS', `found ${(res.items || []).length} spaces`);
    } catch (e) {
      log('list_wiki_spaces', 'FAIL', e.message);
    }

    // 28. search_wiki
    try {
      const res = await officialClient.searchWiki('测试');
      log('search_wiki', 'PASS', `found ${(res.items || []).length} nodes`);
    } catch (e) {
      log('search_wiki', 'FAIL', e.message);
    }

    // 29. list_wiki_nodes (skip — needs space_id)
    log('list_wiki_nodes', 'SKIP', 'needs space_id from list_wiki_spaces');

    // 30. list_files
    try {
      const res = await officialClient.listFiles();
      log('list_files', 'PASS', `found ${(res.items || []).length} files`);
    } catch (e) {
      log('list_files', 'FAIL', e.message);
    }

    // 31. create_folder (skip)
    log('create_folder', 'SKIP', 'skipped to avoid creating unnecessary folders');

    // 32. find_user
    try {
      const res = await officialClient.findUserByIdentity({ emails: 'test@test.com' });
      log('find_user', 'PASS', `returned ${(res.userList || []).length} users (expected 0 for test email)`);
    } catch (e) {
      log('find_user', 'FAIL', e.message);
    }

    // ========== UAT Tests ==========

    if (officialClient.hasUAT) {
      // 33. list_user_chats
      let p2pChatId = null;
      try {
        const res = await officialClient.listChatsAsUser({ pageSize: 20 });
        const items = res.items || [];
        // find a p2p chat
        const p2p = items.find(c => c.chat_mode === 'p2p');
        if (p2p) p2pChatId = p2p.chat_id;
        log('list_user_chats', 'PASS', `found ${items.length} chats, p2p=${p2pChatId || 'none'}`);
      } catch (e) {
        log('list_user_chats', 'FAIL', e.message);
      }

      // 34. read_p2p_messages
      if (p2pChatId) {
        try {
          const res = await officialClient.readMessagesAsUser(p2pChatId, { pageSize: 3 });
          log('read_p2p_messages', 'PASS', `got ${(res.items || []).length} messages`);
        } catch (e) {
          log('read_p2p_messages', 'FAIL', e.message);
        }
      } else {
        log('read_p2p_messages', 'SKIP', 'no P2P chat found');
      }
    } else {
      log('list_user_chats', 'SKIP', 'no UAT configured');
      log('read_p2p_messages', 'SKIP', 'no UAT configured');
    }
  }

  // ========== Summary ==========
  console.log('\n========== TEST SUMMARY ==========');
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  console.log(`PASS: ${pass}  FAIL: ${fail}  SKIP: ${skip}  TOTAL: ${results.length}`);
  if (fail > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  ❌ ${r.tool}: ${r.detail}`);
    }
  }
}

main().catch(console.error);
