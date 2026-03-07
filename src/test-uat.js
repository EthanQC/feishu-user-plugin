const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const uat = process.env.LARK_USER_ACCESS_TOKEN;
if (!uat) { console.log('No UAT in .env'); process.exit(1); }

async function run() {
  // 1. List all chats
  const chatRes = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=100', {
    headers: { 'Authorization': `Bearer ${uat}` },
  });
  const chatData = await chatRes.json();
  if (chatData.code !== 0) {
    console.log('Chat list error:', chatData.code, chatData.msg);
    return;
  }

  const chats = chatData.data.items || [];
  console.log('=== User Chats (' + chats.length + ') ===');
  for (const c of chats) {
    console.log(' ', c.chat_id, '|', c.chat_mode || '-', '|', c.name || '(P2P)');
  }

  // 2. Try reading messages from a chat (use "飞书plugin测试群" first)
  const testChat = chats.find(c => c.name && c.name.includes('测试群'));
  if (testChat) {
    console.log('\n=== Reading messages from:', testChat.name, '===');
    const msgRes = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${testChat.chat_id}&page_size=3&sort_type=ByCreateTimeDesc`,
      { headers: { 'Authorization': `Bearer ${uat}` } }
    );
    const msgData = await msgRes.json();
    if (msgData.code !== 0) {
      console.log('Message read error:', msgData.code, msgData.msg);
    } else {
      const msgs = msgData.data.items || [];
      console.log('Messages:', msgs.length);
      for (const m of msgs) {
        let content = m.body?.content || '';
        try { content = JSON.parse(content); } catch {}
        const text = typeof content === 'object' ? (content.text || content.title || JSON.stringify(content).slice(0, 80)) : content;
        console.log('  [' + m.msg_type + ']', text.slice(0, 100));
      }
    }
  }

  // 3. Try reading a P2P chat - use "Feishu Assistant" or create one
  const p2pChat = chats.find(c => c.name && c.name.includes('Feishu Assistant'));
  if (p2pChat) {
    console.log('\n=== Reading P2P messages from:', p2pChat.name, '===');
    const msgRes = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${p2pChat.chat_id}&page_size=3&sort_type=ByCreateTimeDesc`,
      { headers: { 'Authorization': `Bearer ${uat}` } }
    );
    const msgData = await msgRes.json();
    if (msgData.code !== 0) {
      console.log('P2P read error:', msgData.code, msgData.msg);
    } else {
      const msgs = msgData.data.items || [];
      console.log('P2P Messages:', msgs.length);
      for (const m of msgs) {
        let content = m.body?.content || '';
        try { content = JSON.parse(content); } catch {}
        const text = typeof content === 'object' ? (content.text || content.title || JSON.stringify(content).slice(0, 80)) : content;
        console.log('  [' + m.msg_type + ']', text.slice(0, 100));
      }
    }
  }
}

run().catch(e => console.error(e));
