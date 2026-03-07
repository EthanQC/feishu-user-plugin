const lark = require('@larksuiteoapi/node-sdk');

class LarkOfficialClient {
  constructor(appId, appSecret) {
    this.client = new lark.Client({ appId, appSecret, disableTokenCache: false });
  }

  // --- IM ---

  async listChats({ pageSize = 20, pageToken } = {}) {
    const res = await this.client.im.chat.list({ params: { page_size: pageSize, page_token: pageToken } });
    if (res.code !== 0) throw new Error(`listChats failed: ${res.msg}`);
    return { items: res.data.items || [], pageToken: res.data.page_token, hasMore: res.data.has_more };
  }

  async readMessages(chatId, { pageSize = 20, startTime, endTime, pageToken } = {}) {
    const params = { container_id_type: 'chat', container_id: chatId, page_size: pageSize };
    if (startTime) params.start_time = startTime;
    if (endTime) params.end_time = endTime;
    if (pageToken) params.page_token = pageToken;
    const res = await this.client.im.message.list({ params });
    if (res.code !== 0) throw new Error(`readMessages failed: ${res.msg}`);
    return { items: (res.data.items || []).map(m => this._formatMessage(m)), hasMore: res.data.has_more, pageToken: res.data.page_token };
  }

  async getMessage(messageId) {
    const res = await this.client.im.message.get({ path: { message_id: messageId } });
    if (res.code !== 0) throw new Error(`getMessage failed: ${res.msg}`);
    return this._formatMessage(res.data);
  }

  async replyMessage(messageId, text, msgType = 'text') {
    const content = msgType === 'text' ? JSON.stringify({ text }) : text;
    const res = await this.client.im.message.reply({
      path: { message_id: messageId },
      data: { content, msg_type: msgType },
    });
    if (res.code !== 0) throw new Error(`replyMessage failed: ${res.msg}`);
    return { messageId: res.data.message_id };
  }

  async forwardMessage(messageId, receiverId, receiveIdType = 'chat_id') {
    const res = await this.client.im.message.forward({
      path: { message_id: messageId },
      data: { receive_id: receiverId },
      params: { receive_id_type: receiveIdType },
    });
    if (res.code !== 0) throw new Error(`forwardMessage failed: ${res.msg}`);
    return { messageId: res.data.message_id };
  }

  // --- Docs ---

  async searchDocs(query, { pageSize = 10, pageToken } = {}) {
    const res = await this.client.docx.builtin.search({
      data: { search_key: query, count: pageSize, offset: pageToken ? parseInt(pageToken) : 0 },
    });
    if (res.code !== 0) throw new Error(`searchDocs failed: ${res.msg}`);
    return { items: res.data.docs_entities || [], hasMore: res.data.has_more };
  }

  async readDoc(documentId) {
    const res = await this.client.docx.document.rawContent({ path: { document_id: documentId }, params: { lang: 0 } });
    if (res.code !== 0) throw new Error(`readDoc failed: ${res.msg}`);
    return { content: res.data.content };
  }

  async createDoc(title, folderId) {
    const res = await this.client.docx.document.create({ data: { title, folder_token: folderId || '' } });
    if (res.code !== 0) throw new Error(`createDoc failed: ${res.msg}`);
    return { documentId: res.data.document?.document_id };
  }

  async getDocBlocks(documentId) {
    const res = await this.client.docx.documentBlock.list({ path: { document_id: documentId }, params: { page_size: 500 } });
    if (res.code !== 0) throw new Error(`getDocBlocks failed: ${res.msg}`);
    return { items: res.data.items || [] };
  }

  // --- Bitable ---

  async listBitableTables(appToken) {
    const res = await this.client.bitable.appTable.list({ path: { app_token: appToken } });
    if (res.code !== 0) throw new Error(`listTables failed: ${res.msg}`);
    return { items: res.data.items || [] };
  }

  async listBitableFields(appToken, tableId) {
    const res = await this.client.bitable.appTableField.list({ path: { app_token: appToken, table_id: tableId } });
    if (res.code !== 0) throw new Error(`listFields failed: ${res.msg}`);
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
    if (res.code !== 0) throw new Error(`searchRecords failed: ${res.msg}`);
    return { items: res.data.items || [], total: res.data.total, hasMore: res.data.has_more };
  }

  async createBitableRecord(appToken, tableId, fields) {
    const res = await this.client.bitable.appTableRecord.create({
      path: { app_token: appToken, table_id: tableId },
      data: { fields },
    });
    if (res.code !== 0) throw new Error(`createRecord failed: ${res.msg}`);
    return { recordId: res.data.record?.record_id };
  }

  async updateBitableRecord(appToken, tableId, recordId, fields) {
    const res = await this.client.bitable.appTableRecord.update({
      path: { app_token: appToken, table_id: tableId, record_id: recordId },
      data: { fields },
    });
    if (res.code !== 0) throw new Error(`updateRecord failed: ${res.msg}`);
    return { recordId: res.data.record?.record_id };
  }

  // --- Wiki ---

  async listWikiSpaces() {
    const res = await this.client.wiki.space.list({ params: { page_size: 50 } });
    if (res.code !== 0) throw new Error(`listSpaces failed: ${res.msg}`);
    return { items: res.data.items || [] };
  }

  async searchWiki(query) {
    const res = await this.client.wiki.node.search({
      data: { query },
      params: { page_size: 20 },
    });
    if (res.code !== 0) throw new Error(`searchWiki failed: ${res.msg}`);
    return { items: res.data.items || [] };
  }

  async getWikiNode(spaceId, nodeToken) {
    const res = await this.client.wiki.space.getNode({
      params: { token: nodeToken },
    });
    if (res.code !== 0) throw new Error(`getNode failed: ${res.msg}`);
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
    if (res.code !== 0) throw new Error(`listNodes failed: ${res.msg}`);
    return { items: res.data.items || [], hasMore: res.data.has_more };
  }

  // --- Drive ---

  async listFiles(folderToken, { pageSize = 50, pageToken } = {}) {
    const params = { page_size: pageSize, folder_token: folderToken || '' };
    if (pageToken) params.page_token = pageToken;
    const res = await this.client.drive.file.list({ params });
    if (res.code !== 0) throw new Error(`listFiles failed: ${res.msg}`);
    return { items: res.data.files || [], hasMore: res.data.has_more };
  }

  async createFolder(name, parentToken) {
    const res = await this.client.drive.file.createFolder({
      data: { name, folder_token: parentToken || '' },
    });
    if (res.code !== 0) throw new Error(`createFolder failed: ${res.msg}`);
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
    if (res.code !== 0) throw new Error(`findUser failed: ${res.msg}`);
    return { userList: res.data.user_list || [] };
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
      createTime: m.create_time,
      updateTime: m.update_time,
    };
  }
}

module.exports = { LarkOfficialClient };
