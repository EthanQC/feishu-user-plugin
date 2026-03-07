const lark = require('@larksuiteoapi/node-sdk');

class LarkOfficialClient {
  constructor(appId, appSecret) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.client = new lark.Client({ appId, appSecret, disableTokenCache: false });
    this._uat = null;
    this._uatRefresh = null;
    this._uatExpires = 0;
  }

  // --- UAT (User Access Token) Management ---

  loadUAT() {
    const token = process.env.LARK_USER_ACCESS_TOKEN;
    const refresh = process.env.LARK_USER_REFRESH_TOKEN;
    const expires = parseInt(process.env.LARK_UAT_EXPIRES || '0');
    if (token) {
      this._uat = token;
      this._uatRefresh = refresh || null;
      this._uatExpires = expires;
    }
  }

  get hasUAT() {
    return !!this._uat;
  }

  async _getValidUAT() {
    if (!this._uat) throw new Error('No user_access_token. Run: node src/oauth.js');

    const now = Math.floor(Date.now() / 1000);
    if (this._uatExpires > now + 300) return this._uat;

    if (!this._uatRefresh) throw new Error('UAT expired and no refresh token. Run: node src/oauth.js');

    const res = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.appId,
        client_secret: this.appSecret,
        refresh_token: this._uatRefresh,
      }),
    });
    const data = await res.json();
    // v2 response: access_token at top level or under data
    const tokenData = data.access_token ? data : data.data;
    if (!tokenData?.access_token) throw new Error(`UAT refresh failed: ${JSON.stringify(data)}. Run: node src/oauth.js`);

    this._uat = tokenData.access_token;
    this._uatRefresh = tokenData.refresh_token;
    this._uatExpires = now + tokenData.expires_in;

    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    try {
      let env = fs.readFileSync(envPath, 'utf8');
      for (const [key, val] of Object.entries({
        LARK_USER_ACCESS_TOKEN: this._uat,
        LARK_USER_REFRESH_TOKEN: this._uatRefresh,
        LARK_UAT_EXPIRES: String(this._uatExpires),
      })) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(env)) env = env.replace(regex, `${key}=${val}`);
        else env += `\n${key}=${val}`;
      }
      fs.writeFileSync(envPath, env.trim() + '\n');
    } catch {}

    console.error('[feishu-user-mcp] UAT refreshed successfully');
    return this._uat;
  }

  // --- UAT-based IM operations (for P2P chats) ---

  async listChatsAsUser({ pageSize = 20, pageToken } = {}) {
    const uat = await this._getValidUAT();
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) params.set('page_token', pageToken);
    const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/chats?${params}`, {
      headers: { 'Authorization': `Bearer ${uat}` },
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listChatsAsUser failed (${data.code}): ${data.msg}`);
    return { items: data.data.items || [], pageToken: data.data.page_token, hasMore: data.data.has_more };
  }

  async readMessagesAsUser(chatId, { pageSize = 20, startTime, endTime, pageToken } = {}) {
    const uat = await this._getValidUAT();
    const params = new URLSearchParams({
      container_id_type: 'chat', container_id: chatId, page_size: String(pageSize),
    });
    if (startTime) params.set('start_time', startTime);
    if (endTime) params.set('end_time', endTime);
    if (pageToken) params.set('page_token', pageToken);
    const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?${params}`, {
      headers: { 'Authorization': `Bearer ${uat}` },
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`readMessagesAsUser failed (${data.code}): ${data.msg}`);
    return {
      items: (data.data.items || []).map(m => this._formatMessage(m)),
      hasMore: data.data.has_more,
      pageToken: data.data.page_token,
    };
  }

  // --- IM ---

  async listChats({ pageSize = 20, pageToken } = {}) {
    const res = await this.client.im.chat.list({ params: { page_size: pageSize, page_token: pageToken } });
    if (res.code !== 0) throw new Error(`listChats failed (${res.code}): ${res.msg}`);
    return { items: res.data.items || [], pageToken: res.data.page_token, hasMore: res.data.has_more };
  }

  async readMessages(chatId, { pageSize = 20, startTime, endTime, pageToken } = {}) {
    const params = { container_id_type: 'chat', container_id: chatId, page_size: pageSize };
    if (startTime) params.start_time = startTime;
    if (endTime) params.end_time = endTime;
    if (pageToken) params.page_token = pageToken;
    const res = await this.client.im.message.list({ params });
    if (res.code !== 0) throw new Error(`readMessages failed (${res.code}): ${res.msg}`);
    return { items: (res.data.items || []).map(m => this._formatMessage(m)), hasMore: res.data.has_more, pageToken: res.data.page_token };
  }

  async getMessage(messageId) {
    const res = await this.client.im.message.get({ path: { message_id: messageId } });
    if (res.code !== 0) throw new Error(`getMessage failed (${res.code}): ${res.msg}`);
    return this._formatMessage(res.data);
  }

  async replyMessage(messageId, text, msgType = 'text') {
    const content = msgType === 'text' ? JSON.stringify({ text }) : text;
    const res = await this.client.im.message.reply({
      path: { message_id: messageId },
      data: { content, msg_type: msgType },
    });
    if (res.code !== 0) throw new Error(`replyMessage failed (${res.code}): ${res.msg}`);
    return { messageId: res.data.message_id };
  }

  async forwardMessage(messageId, receiverId, receiveIdType = 'chat_id') {
    const res = await this.client.im.message.forward({
      path: { message_id: messageId },
      data: { receive_id: receiverId },
      params: { receive_id_type: receiveIdType },
    });
    if (res.code !== 0) throw new Error(`forwardMessage failed (${res.code}): ${res.msg}`);
    return { messageId: res.data.message_id };
  }

  // --- Docs ---

  async searchDocs(query, { pageSize = 10, pageToken } = {}) {
    const res = await this.client.request({
      method: 'POST',
      url: '/open-apis/suite/docs-api/search/object',
      data: { search_key: query, count: pageSize, offset: pageToken ? parseInt(pageToken) : 0, owner_ids: [], chat_ids: [], docs_types: [] },
    });
    if (res.code !== 0) throw new Error(`searchDocs failed (${res.code}): ${res.msg}`);
    return { items: res.data.docs_entities || [], hasMore: res.data.has_more };
  }

  async readDoc(documentId) {
    const res = await this.client.docx.document.rawContent({ path: { document_id: documentId }, params: { lang: 0 } });
    if (res.code !== 0) throw new Error(`readDoc failed (${res.code}): ${res.msg}`);
    return { content: res.data.content };
  }

  async createDoc(title, folderId) {
    const res = await this.client.docx.document.create({ data: { title, folder_token: folderId || '' } });
    if (res.code !== 0) throw new Error(`createDoc failed (${res.code}): ${res.msg}`);
    return { documentId: res.data.document?.document_id };
  }

  async getDocBlocks(documentId) {
    const res = await this.client.docx.documentBlock.list({ path: { document_id: documentId }, params: { page_size: 500 } });
    if (res.code !== 0) throw new Error(`getDocBlocks failed (${res.code}): ${res.msg}`);
    return { items: res.data.items || [] };
  }

  // --- Bitable ---

  async listBitableTables(appToken) {
    const res = await this.client.bitable.appTable.list({ path: { app_token: appToken } });
    if (res.code !== 0) throw new Error(`listTables failed (${res.code}): ${res.msg}`);
    return { items: res.data.items || [] };
  }

  async listBitableFields(appToken, tableId) {
    const res = await this.client.bitable.appTableField.list({ path: { app_token: appToken, table_id: tableId } });
    if (res.code !== 0) throw new Error(`listFields failed (${res.code}): ${res.msg}`);
    return { items: res.data.items || [] };
  }

  async searchBitableRecords(appToken, tableId, { filter, sort, pageSize = 20, pageToken } = {}) {
    const data = {};
    if (filter) data.filter = filter;
    if (sort) data.sort = sort;
    if (pageSize) data.page_size = pageSize;
    if (pageToken) data.page_token = pageToken;
    const res = await this.client.bitable.appTableRecord.search({
      path: { app_token: appToken, table_id: tableId },
      data,
    });
    if (res.code !== 0) throw new Error(`searchRecords failed (${res.code}): ${res.msg}`);
    return { items: res.data.items || [], total: res.data.total, hasMore: res.data.has_more };
  }

  async createBitableRecord(appToken, tableId, fields) {
    const res = await this.client.bitable.appTableRecord.create({
      path: { app_token: appToken, table_id: tableId },
      data: { fields },
    });
    if (res.code !== 0) throw new Error(`createRecord failed (${res.code}): ${res.msg}`);
    return { recordId: res.data.record?.record_id };
  }

  async updateBitableRecord(appToken, tableId, recordId, fields) {
    const res = await this.client.bitable.appTableRecord.update({
      path: { app_token: appToken, table_id: tableId, record_id: recordId },
      data: { fields },
    });
    if (res.code !== 0) throw new Error(`updateRecord failed (${res.code}): ${res.msg}`);
    return { recordId: res.data.record?.record_id };
  }

  // --- Wiki ---

  async listWikiSpaces() {
    const res = await this.client.wiki.space.list({ params: { page_size: 50 } });
    if (res.code !== 0) throw new Error(`listSpaces failed (${res.code}): ${res.msg}`);
    return { items: res.data.items || [] };
  }

  async searchWiki(query) {
    const res = await this.client.request({
      method: 'POST',
      url: '/open-apis/suite/docs-api/search/object',
      data: { search_key: query, count: 20, offset: 0, owner_ids: [], chat_ids: [], docs_types: ['wiki'] },
    });
    if (res.code !== 0) throw new Error(`searchWiki failed (${res.code}): ${res.msg}`);
    return { items: res.data.docs_entities || [] };
  }

  async getWikiNode(spaceId, nodeToken) {
    const res = await this.client.wiki.space.getNode({
      params: { token: nodeToken },
    });
    if (res.code !== 0) throw new Error(`getNode failed (${res.code}): ${res.msg}`);
    return res.data.node;
  }

  async listWikiNodes(spaceId, { parentNodeToken, pageToken } = {}) {
    const params = { page_size: 50 };
    if (parentNodeToken) params.parent_node_token = parentNodeToken;
    if (pageToken) params.page_token = pageToken;
    const res = await this.client.wiki.spaceNode.list({
      path: { space_id: spaceId },
      params,
    });
    if (res.code !== 0) throw new Error(`listNodes failed (${res.code}): ${res.msg}`);
    return { items: res.data.items || [], hasMore: res.data.has_more };
  }

  // --- Drive ---

  async listFiles(folderToken, { pageSize = 50, pageToken } = {}) {
    const params = { page_size: pageSize, folder_token: folderToken || '' };
    if (pageToken) params.page_token = pageToken;
    const res = await this.client.drive.file.list({ params });
    if (res.code !== 0) throw new Error(`listFiles failed (${res.code}): ${res.msg}`);
    return { items: res.data.files || [], hasMore: res.data.has_more };
  }

  async createFolder(name, parentToken) {
    const res = await this.client.drive.file.createFolder({
      data: { name, folder_token: parentToken || '' },
    });
    if (res.code !== 0) throw new Error(`createFolder failed (${res.code}): ${res.msg}`);
    return { token: res.data.token };
  }

  // --- Contact ---

  async findUserByIdentity({ emails, mobiles } = {}) {
    const data = {};
    if (emails) data.emails = Array.isArray(emails) ? emails : [emails];
    if (mobiles) data.mobiles = Array.isArray(mobiles) ? mobiles : [mobiles];
    const res = await this.client.contact.user.batchGetId({
      data,
      params: { user_id_type: 'open_id' },
    });
    if (res.code !== 0) throw new Error(`findUser failed (${res.code}): ${res.msg}`);
    return { userList: res.data.user_list || [] };
  }

  // --- Chat ID Resolution ---

  async listAllChats() {
    const allChats = [];
    let pageToken;
    let hasMore = true;
    while (hasMore) {
      const res = await this.client.im.chat.list({ params: { page_size: 100, page_token: pageToken } });
      if (res.code !== 0) throw new Error(`listAllChats failed (${res.code}): ${res.msg}`);
      allChats.push(...(res.data.items || []));
      pageToken = res.data.page_token;
      hasMore = res.data.has_more && !!pageToken;
    }
    return allChats;
  }

  // --- Helpers ---

  _formatMessage(m) {
    if (!m) return null;
    let body = m.body?.content || '';
    try { body = JSON.parse(body); } catch {}
    return {
      messageId: m.message_id,
      chatId: m.chat_id,
      senderId: m.sender?.id,
      senderType: m.sender?.sender_type,
      msgType: m.msg_type,
      content: body,
      createTime: this._normalizeTimestamp(m.create_time),
      updateTime: this._normalizeTimestamp(m.update_time),
    };
  }

  _normalizeTimestamp(ts) {
    if (!ts) return null;
    const n = parseInt(ts);
    // Feishu returns millisecond strings; normalize to seconds
    return String(n > 1e12 ? Math.floor(n / 1000) : n);
  }
}

module.exports = { LarkOfficialClient };
