const lark = require('@larksuiteoapi/node-sdk');
const { fetchWithTimeout } = require('./utils');

// Redirect all Lark SDK logs to stderr.
// The SDK's defaultLogger.error uses console.log (stdout), which corrupts
// MCP's JSON-RPC stdio transport and causes session disconnects.
const stderrLogger = {
  error: (...msg) => console.error('[lark-sdk][error]:', ...msg),
  warn:  (...msg) => console.error('[lark-sdk][warn]:', ...msg),
  info:  () => {},
  debug: () => {},
  trace: () => {},
};

class LarkOfficialClient {
  constructor(appId, appSecret) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.client = new lark.Client({ appId, appSecret, disableTokenCache: false, logger: stderrLogger, loggerLevel: lark.LoggerLevel.warn });
    this._uat = null;
    this._uatRefresh = null;
    this._uatExpires = 0;
    this._userNameCache = new Map(); // open_id → display name
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

  // Fetches (and caches) an app_access_token directly via the internal endpoint.
  // Avoids relying on SDK-internal token-manager APIs that may change across versions.
  async _getAppToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this._appToken && this._appTokenExpires > now + 60) return this._appToken;
    const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      timeoutMs: 10000,
    });
    const data = await res.json();
    if (data.code !== 0 || !data.app_access_token) {
      throw new Error(`app_access_token failed: ${data.code}: ${data.msg || 'unknown'}`);
    }
    this._appToken = data.app_access_token;
    this._appTokenExpires = now + (typeof data.expire === 'number' ? data.expire : 7200);
    return this._appToken;
  }

  // Probe APP_ID/SECRET validity by requesting a tenant access token.
  // Catches the common "user's Claude filled in a wrong/stale APP_ID" failure mode
  // (observed in production: 周宇's machine ran with an APP_ID nobody recognized,
  // causing all Official API calls to 401 with cryptic messages that looked like
  // MCP "掉线" to the user). Returns { valid, appId, appName?, error? }.
  async verifyApp() {
    try {
      const token = await this._getAppToken();
      // Try to fetch app display name (best-effort; requires application scope)
      let appName = null;
      try {
        const infoRes = await fetchWithTimeout(`https://open.feishu.cn/open-apis/application/v6/applications/${this.appId}?lang=zh_cn`, {
          headers: { 'Authorization': `Bearer ${token}` },
          timeoutMs: 10000,
        });
        const info = await infoRes.json();
        if (info.code === 0) appName = info.data?.app?.app_name || null;
      } catch (_) { /* name is best-effort; valid creds still matter most */ }
      return { valid: true, appId: this.appId, appName };
    } catch (e) {
      return { valid: false, appId: this.appId, error: e.message };
    }
  }

  async _getValidUAT() {
    if (!this._uat) throw new Error('No user_access_token. Run: npx feishu-user-plugin oauth');

    const now = Math.floor(Date.now() / 1000);
    // Proactively refresh if we know it's expiring within 5 min
    if (this._uatExpires > 0 && this._uatExpires <= now + 300) {
      return this._refreshUAT();
    }
    return this._uat;
  }

  async _refreshUAT() {
    if (!this._uatRefresh) throw new Error('UAT expired and no refresh token. Run: npx feishu-user-plugin oauth');

    const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
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
    const tokenData = data.access_token ? data : data.data;
    if (!tokenData?.access_token) throw new Error(`UAT refresh failed: ${JSON.stringify(data)}. Run: npx feishu-user-plugin oauth`);

    this._uat = tokenData.access_token;
    this._uatRefresh = tokenData.refresh_token || this._uatRefresh;
    const expiresIn = typeof tokenData.expires_in === 'number' && tokenData.expires_in > 0 ? tokenData.expires_in : 7200;
    this._uatExpires = Math.floor(Date.now() / 1000) + expiresIn;
    this._persistUAT();
    console.error('[feishu-user-plugin] UAT refreshed successfully');
    return this._uat;
  }

  _persistUAT() {
    // Lazy require to avoid circular dependency at module load time
    const { persistToConfig } = require('./config');
    persistToConfig({
      LARK_USER_ACCESS_TOKEN: this._uat,
      LARK_USER_REFRESH_TOKEN: this._uatRefresh,
      LARK_UAT_EXPIRES: String(this._uatExpires),
    });
  }

  // --- UAT-based IM operations (for P2P chats) ---

  // Wrapper: call fn with UAT, retry once after refresh if auth fails
  async _withUAT(fn) {
    let uat = await this._getValidUAT();
    const data = await fn(uat);
    // Known auth error codes: 99991668 (invalid), 99991663 (expired), 99991677 (auth_expired)
    if (data.code === 99991668 || data.code === 99991663 || data.code === 99991677) {
      // Token invalid/expired — try refresh once
      uat = await this._refreshUAT();
      return fn(uat);
    }
    return data;
  }

  // Generic UAT REST helper. Returns parsed JSON ({code, msg, data}).
  async _uatREST(method, path, { body, query } = {}) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const url = 'https://open.feishu.cn' + path + qs;
    return this._withUAT(async (uat) => {
      const headers = { 'Authorization': `Bearer ${uat}` };
      const init = { method, headers };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await fetchWithTimeout(url, init);
      return res.json();
    });
  }

  // Try UAT first (for resources likely owned by the user), fall back to app SDK on failure.
  // Returns SDK-shaped {code, msg, data, _viaUser}. _viaUser is true iff the UAT call succeeded;
  // callers can surface this to distinguish "created by user" vs "created by app" for resources
  // whose ownership matters (docs, bitables, folders).
  async _asUserOrApp({ uatPath, method = 'GET', body, query, sdkFn, label }) {
    if (this.hasUAT) {
      try {
        const data = await this._uatREST(method, uatPath, { body, query });
        if (data.code === 0) {
          data._viaUser = true;
          return data;
        }
        console.error(`[feishu-user-plugin] ${label} as user failed (${data.code}: ${data.msg}), retrying as app`);
      } catch (err) {
        console.error(`[feishu-user-plugin] ${label} as user threw (${err.message}), retrying as app`);
      }
    }
    const appData = await this._safeSDKCall(sdkFn, label);
    if (appData && typeof appData === 'object') appData._viaUser = false;
    return appData;
  }

  async listChatsAsUser({ pageSize = 20, pageToken } = {}) {
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) params.set('page_token', pageToken);
    const data = await this._withUAT(async (uat) => {
      const res = await fetchWithTimeout(`https://open.feishu.cn/open-apis/im/v1/chats?${params}`, {
        headers: { 'Authorization': `Bearer ${uat}` },
      });
      return res.json();
    });
    if (data.code !== 0) throw new Error(`listChatsAsUser failed (${data.code}): ${data.msg}`);
    return { items: data.data.items || [], pageToken: data.data.page_token, hasMore: data.data.has_more };
  }

  async readMessagesAsUser(chatId, { pageSize = 20, startTime, endTime, pageToken, sortType = 'ByCreateTimeDesc' } = {}, userClient) {
    // Feishu API requires end_time >= start_time; auto-set end_time to now if missing
    if (startTime && !endTime) {
      endTime = String(Math.floor(Date.now() / 1000));
    }
    const params = new URLSearchParams({
      container_id_type: 'chat', container_id: chatId, page_size: String(pageSize),
      sort_type: sortType,
    });
    if (startTime) params.set('start_time', startTime);
    if (endTime) params.set('end_time', endTime);
    if (pageToken) params.set('page_token', pageToken);
    const data = await this._withUAT(async (uat) => {
      const res = await fetchWithTimeout(`https://open.feishu.cn/open-apis/im/v1/messages?${params}`, {
        headers: { 'Authorization': `Bearer ${uat}` },
      });
      return res.json();
    });
    if (data.code !== 0) throw new Error(`readMessagesAsUser failed (${data.code}): ${data.msg}`);
    const items = (data.data.items || []).map(m => this._formatMessage(m));
    await this._populateSenderNames(items, userClient);
    return { items, hasMore: data.data.has_more, pageToken: data.data.page_token };
  }

  // --- IM ---

  async listChats({ pageSize = 20, pageToken } = {}) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.list({ params: { page_size: pageSize, page_token: pageToken } }),
      'listChats'
    );
    return { items: res.data.items || [], pageToken: res.data.page_token, hasMore: res.data.has_more };
  }

  async readMessages(chatId, { pageSize = 20, startTime, endTime, pageToken, sortType = 'ByCreateTimeDesc' } = {}, userClient) {
    const params = { container_id_type: 'chat', container_id: chatId, page_size: pageSize, sort_type: sortType };
    if (startTime) params.start_time = startTime;
    if (endTime) params.end_time = endTime;
    if (pageToken) params.page_token = pageToken;
    const res = await this._safeSDKCall(() => this.client.im.message.list({ params }), 'readMessages');
    const items = (res.data.items || []).map(m => this._formatMessage(m));
    await this._populateSenderNames(items, userClient);
    return { items, hasMore: res.data.has_more, pageToken: res.data.page_token };
  }

  async getMessage(messageId) {
    const res = await this._safeSDKCall(
      () => this.client.im.message.get({ path: { message_id: messageId } }),
      'getMessage'
    );
    return this._formatMessage(res.data);
  }

  // Download a resource (image/file) attached to a message.
  // Tries UAT first (works for any chat the user is in), falls back to app token
  // (requires the bot to be in the same chat — Feishu restriction).
  // resourceType: 'image' | 'file'. Returns { base64, mimeType, viaUser }.
  async downloadMessageResource(messageId, fileKey, resourceType = 'image') {
    const path = `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${encodeURIComponent(resourceType)}`;
    const url = 'https://open.feishu.cn' + path;

    // Attempt 1: user identity
    if (this.hasUAT) {
      try {
        const uat = await this._getValidUAT();
        const res = await fetchWithTimeout(url, {
          headers: { 'Authorization': `Bearer ${uat}` },
          timeoutMs: 60000,
        });
        if (res.ok && !res.headers.get('content-type')?.includes('application/json')) {
          const buf = Buffer.from(await res.arrayBuffer());
          return {
            base64: buf.toString('base64'),
            mimeType: res.headers.get('content-type') || 'application/octet-stream',
            bytes: buf.length,
            viaUser: true,
          };
        }
        const errJson = await res.json().catch(() => null);
        console.error(`[feishu-user-plugin] downloadMessageResource as user failed: ${errJson?.code}: ${errJson?.msg || res.statusText}, retrying as app`);
      } catch (e) {
        console.error(`[feishu-user-plugin] downloadMessageResource as user threw (${e.message}), retrying as app`);
      }
    }

    // Attempt 2: app identity
    const token = await this._getAppToken();
    const res = await fetchWithTimeout(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeoutMs: 60000,
    });
    if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
      const errJson = await res.json().catch(() => null);
      throw new Error(`downloadMessageResource failed: ${errJson?.code}: ${errJson?.msg || res.statusText}. Note: app identity requires the bot to be in the same chat.`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      base64: buf.toString('base64'),
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
      bytes: buf.length,
      viaUser: false,
    };
  }

  async replyMessage(messageId, text, msgType = 'text') {
    const content = msgType === 'text' ? JSON.stringify({ text }) : text;
    const res = await this._safeSDKCall(
      () => this.client.im.message.reply({ path: { message_id: messageId }, data: { content, msg_type: msgType } }),
      'replyMessage'
    );
    return { messageId: res.data.message_id };
  }

  async forwardMessage(messageId, receiverId, receiveIdType = 'chat_id') {
    const res = await this._safeSDKCall(
      () => this.client.im.message.forward({
        path: { message_id: messageId },
        data: { receive_id: receiverId },
        params: { receive_id_type: receiveIdType },
      }),
      'forwardMessage'
    );
    return { messageId: res.data.message_id };
  }

  // --- IM: Send (Bot Identity) ---

  async sendMessageAsBot(chatId, msgType, content, receiveIdType = 'chat_id') {
    const res = await this._safeSDKCall(
      () => this.client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: { receive_id: chatId, msg_type: msgType, content: typeof content === 'string' ? content : JSON.stringify(content) },
      }),
      'sendMessage'
    );
    return { messageId: res.data.message_id };
  }

  async deleteMessage(messageId) {
    await this._safeSDKCall(
      () => this.client.im.message.delete({ path: { message_id: messageId } }),
      'deleteMessage'
    );
    return { deleted: true };
  }

  async updateMessage(messageId, msgType, content) {
    const res = await this._safeSDKCall(
      () => this.client.im.message.patch({
        path: { message_id: messageId },
        data: { msg_type: msgType, content: typeof content === 'string' ? content : JSON.stringify(content) },
      }),
      'updateMessage'
    );
    return { messageId: res.data?.message_id || messageId };
  }

  // --- IM: Reactions ---

  async addReaction(messageId, emojiType) {
    const res = await this._safeSDKCall(
      () => this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      }),
      'addReaction'
    );
    return { reactionId: res.data.reaction_id };
  }

  async deleteReaction(messageId, reactionId) {
    await this._safeSDKCall(
      () => this.client.im.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      }),
      'deleteReaction'
    );
    return { deleted: true };
  }

  // --- IM: Pins ---

  async pinMessage(messageId, pinned = true) {
    if (pinned) {
      const res = await this._safeSDKCall(
        () => this.client.im.pin.create({ data: { message_id: messageId } }),
        'pinMessage'
      );
      return { pin: res.data.pin };
    }
    await this._safeSDKCall(
      () => this.client.im.pin.delete({ data: { message_id: messageId } }),
      'unpinMessage'
    );
    return { unpinned: true };
  }

  // --- IM: Chat Management ---

  async createChat({ name, description, userIds, botIds } = {}) {
    const data = {};
    if (name) data.name = name;
    if (description) data.description = description;
    if (userIds) data.user_id_list = userIds;
    if (botIds) data.bot_id_list = botIds;
    const res = await this._safeSDKCall(
      () => this.client.im.chat.create({ params: { user_id_type: 'open_id' }, data }),
      'createChat'
    );
    return { chatId: res.data.chat_id };
  }

  async updateChat(chatId, { name, description } = {}) {
    const data = {};
    if (name) data.name = name;
    if (description) data.description = description;
    const res = await this._safeSDKCall(
      () => this.client.im.chat.update({ path: { chat_id: chatId }, data }),
      'updateChat'
    );
    return { updated: true };
  }

  async listChatMembers(chatId, { pageSize = 50, pageToken } = {}) {
    const res = await this._safeSDKCall(
      () => this.client.im.chatMembers.get({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id', page_size: pageSize, page_token: pageToken },
      }),
      'listChatMembers'
    );
    return { items: res.data.items || [], hasMore: res.data.has_more, pageToken: res.data.page_token };
  }

  async addChatMembers(chatId, userIds) {
    const res = await this._safeSDKCall(
      () => this.client.im.chatMembers.create({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id' },
        data: { id_list: userIds },
      }),
      'addChatMembers'
    );
    return { invalidIds: res.data.invalid_id_list || [] };
  }

  async removeChatMembers(chatId, userIds) {
    const res = await this._safeSDKCall(
      () => this.client.im.chatMembers.delete({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id' },
        data: { id_list: userIds },
      }),
      'removeChatMembers'
    );
    return { invalidIds: res.data.invalid_id_list || [] };
  }

  // --- Upload ---

  async uploadImage(imagePath, imageType = 'message') {
    const fs = require('fs');
    const res = await this._safeSDKCall(
      () => this.client.im.image.create({
        data: { image_type: imageType, image: fs.createReadStream(imagePath) },
      }),
      'uploadImage'
    );
    // SDK multipart responses may have data at top level or nested under .data
    const imageKey = res.data?.image_key || res.image_key;
    if (!imageKey) throw new Error(`uploadImage: unexpected response structure: ${JSON.stringify(res).slice(0, 500)}`);
    return { imageKey };
  }

  async uploadFile(filePath, fileType = 'stream', fileName) {
    const fs = require('fs');
    const path = require('path');
    if (!fileName) fileName = path.basename(filePath);
    const res = await this._safeSDKCall(
      () => this.client.im.file.create({
        data: {
          file_type: fileType,
          file_name: fileName,
          file: fs.createReadStream(filePath),
        },
      }),
      'uploadFile'
    );
    // SDK multipart responses may have data at top level or nested under .data
    const fileKey = res.data?.file_key || res.file_key;
    if (!fileKey) throw new Error(`uploadFile: unexpected response structure: ${JSON.stringify(res).slice(0, 500)}`);
    return { fileKey };
  }

  // --- Docs ---

  async searchDocs(query, { pageSize = 10, pageToken } = {}) {
    const res = await this._safeSDKCall(
      () => this.client.request({
        method: 'POST', url: '/open-apis/suite/docs-api/search/object',
        data: { search_key: query, count: pageSize, offset: pageToken ? parseInt(pageToken) : 0, owner_ids: [], chat_ids: [], docs_types: [] },
      }),
      'searchDocs'
    );
    return { items: res.data.docs_entities || [], hasMore: res.data.has_more };
  }

  async readDoc(documentId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/raw_content`,
      query: { lang: '0' },
      sdkFn: () => this.client.docx.document.rawContent({ path: { document_id: documentId }, params: { lang: 0 } }),
      label: 'readDoc',
    });
    return { content: res.data.content };
  }

  async createDoc(title, folderId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents`,
      method: 'POST',
      body: { title, folder_token: folderId || '' },
      sdkFn: () => this.client.docx.document.create({ data: { title, folder_token: folderId || '' } }),
      label: 'createDoc',
    });
    return { documentId: res.data.document?.document_id, viaUser: !!res._viaUser };
  }

  async getDocBlocks(documentId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks`,
      query: { page_size: '500' },
      sdkFn: () => this.client.docx.documentBlock.list({ path: { document_id: documentId }, params: { page_size: 500 } }),
      label: 'getDocBlocks',
    });
    return { items: res.data.items || [] };
  }

  async createDocBlock(documentId, parentBlockId, children, index) {
    const data = { children };
    if (index !== undefined) data.index = index;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.docx.documentBlockChildren.create({
        path: { document_id: documentId, block_id: parentBlockId },
        data,
      }),
      label: 'createDocBlock',
    });
    return { blocks: res.data.children || [] };
  }

  async updateDocBlock(documentId, blockId, updateBody) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
      method: 'PATCH',
      body: updateBody,
      sdkFn: () => this.client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: blockId },
        data: updateBody,
      }),
      label: 'updateDocBlock',
    });
    return { block: res.data.block };
  }

  async deleteDocBlocks(documentId, parentBlockId, startIndex, endIndex) {
    await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children/batch_delete`,
      method: 'DELETE',
      body: { start_index: startIndex, end_index: endIndex },
      sdkFn: () => this.client.docx.documentBlockChildren.batchDelete({
        path: { document_id: documentId, block_id: parentBlockId },
        data: { start_index: startIndex, end_index: endIndex },
      }),
      label: 'deleteDocBlocks',
    });
    return { deleted: true };
  }

  // --- Chat Info (Official API) ---

  async getChatInfo(chatId) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.get({ path: { chat_id: chatId } }),
      'getChatInfo'
    );
    return res.data;
  }

  // --- Bitable ---

  async createBitable(name, folderId) {
    const data = {};
    if (name) data.name = name;
    if (folderId) data.folder_token = folderId;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.bitable.app.create({ data }),
      label: 'createBitable',
    });
    return { appToken: res.data.app?.app_token, name: res.data.app?.name, url: res.data.app?.url, viaUser: !!res._viaUser };
  }

  async listBitableTables(appToken) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables`,
      sdkFn: () => this.client.bitable.appTable.list({ path: { app_token: appToken } }),
      label: 'listTables',
    });
    return { items: res.data.items || [] };
  }

  async createBitableTable(appToken, name, fields) {
    const data = { table: { name } };
    if (fields && fields.length > 0) data.table.default_view_name = name;
    if (fields && fields.length > 0) data.table.fields = fields;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.bitable.appTable.create({ path: { app_token: appToken }, data }),
      label: 'createTable',
    });
    return { tableId: res.data.table_id };
  }

  async listBitableFields(appToken, tableId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      sdkFn: () => this.client.bitable.appTableField.list({ path: { app_token: appToken, table_id: tableId } }),
      label: 'listFields',
    });
    return { items: res.data.items || [] };
  }

  async createBitableField(appToken, tableId, fieldConfig) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      method: 'POST',
      body: fieldConfig,
      sdkFn: () => this.client.bitable.appTableField.create({ path: { app_token: appToken, table_id: tableId }, data: fieldConfig }),
      label: 'createField',
    });
    return { field: res.data.field };
  }

  async updateBitableField(appToken, tableId, fieldId, fieldConfig) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
      method: 'PUT',
      body: fieldConfig,
      sdkFn: () => this.client.bitable.appTableField.update({ path: { app_token: appToken, table_id: tableId, field_id: fieldId }, data: fieldConfig }),
      label: 'updateField',
    });
    return { field: res.data.field };
  }

  async deleteBitableField(appToken, tableId, fieldId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableField.delete({ path: { app_token: appToken, table_id: tableId, field_id: fieldId } }),
      label: 'deleteField',
    });
    return { fieldId: res.data.field_id, deleted: res.data.deleted };
  }

  async searchBitableRecords(appToken, tableId, { filter, sort, pageSize = 20, pageToken } = {}) {
    const data = {};
    if (filter) data.filter = filter;
    if (sort) data.sort = sort;
    const query = {};
    if (pageSize) query.page_size = String(pageSize);
    if (pageToken) query.page_token = pageToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
      method: 'POST',
      body: data,
      query,
      sdkFn: () => this.client.bitable.appTableRecord.search({
        path: { app_token: appToken, table_id: tableId },
        params: { page_size: pageSize, ...(pageToken ? { page_token: pageToken } : {}) },
        data,
      }),
      label: 'searchRecords',
    });
    return { items: res.data.items || [], total: res.data.total, hasMore: res.data.has_more };
  }

  async createBitableRecord(appToken, tableId, fields) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      method: 'POST',
      body: { fields },
      sdkFn: () => this.client.bitable.appTableRecord.create({ path: { app_token: appToken, table_id: tableId }, data: { fields } }),
      label: 'createRecord',
    });
    return { recordId: res.data.record?.record_id };
  }

  async updateBitableRecord(appToken, tableId, recordId, fields) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      method: 'PUT',
      body: { fields },
      sdkFn: () => this.client.bitable.appTableRecord.update({ path: { app_token: appToken, table_id: tableId, record_id: recordId }, data: { fields } }),
      label: 'updateRecord',
    });
    return { recordId: res.data.record?.record_id };
  }

  async deleteBitableRecord(appToken, tableId, recordId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableRecord.delete({ path: { app_token: appToken, table_id: tableId, record_id: recordId } }),
      label: 'deleteRecord',
    });
    return { deleted: res.data.deleted };
  }

  async batchCreateBitableRecords(appToken, tableId, records) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      method: 'POST',
      body: { records },
      sdkFn: () => this.client.bitable.appTableRecord.batchCreate({ path: { app_token: appToken, table_id: tableId }, data: { records } }),
      label: 'batchCreateRecords',
    });
    return { records: res.data.records || [] };
  }

  async batchUpdateBitableRecords(appToken, tableId, records) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update`,
      method: 'POST',
      body: { records },
      sdkFn: () => this.client.bitable.appTableRecord.batchUpdate({ path: { app_token: appToken, table_id: tableId }, data: { records } }),
      label: 'batchUpdateRecords',
    });
    return { records: res.data.records || [] };
  }

  async batchDeleteBitableRecords(appToken, tableId, recordIds) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
      method: 'POST',
      body: { records: recordIds },
      sdkFn: () => this.client.bitable.appTableRecord.batchDelete({ path: { app_token: appToken, table_id: tableId }, data: { records: recordIds } }),
      label: 'batchDeleteRecords',
    });
    return { records: res.data.records || [] };
  }

  async listBitableViews(appToken, tableId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      query: { page_size: '50' },
      sdkFn: () => this.client.bitable.appTableView.list({ path: { app_token: appToken, table_id: tableId }, params: { page_size: 50 } }),
      label: 'listViews',
    });
    return { items: res.data.items || [] };
  }

  async getBitableRecord(appToken, tableId, recordId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      sdkFn: () => this.client.bitable.appTableRecord.get({ path: { app_token: appToken, table_id: tableId, record_id: recordId } }),
      label: 'getRecord',
    });
    return { record: res.data.record };
  }

  async deleteBitableTable(appToken, tableId) {
    await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTable.delete({ path: { app_token: appToken, table_id: tableId } }),
      label: 'deleteTable',
    });
    return { deleted: true };
  }

  async getBitableMeta(appToken) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}`,
      sdkFn: () => this.client.bitable.app.get({ path: { app_token: appToken } }),
      label: 'getBitableMeta',
    });
    return { app: res.data.app };
  }

  async updateBitableTable(appToken, tableId, name) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      method: 'PATCH',
      body: { name },
      sdkFn: () => this.client.bitable.appTable.patch({ path: { app_token: appToken, table_id: tableId }, data: { name } }),
      label: 'updateTable',
    });
    return { name: res.data.name };
  }

  async createBitableView(appToken, tableId, viewName, viewType = 'grid') {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      method: 'POST',
      body: { view_name: viewName, view_type: viewType },
      sdkFn: () => this.client.bitable.appTableView.create({ path: { app_token: appToken, table_id: tableId }, data: { view_name: viewName, view_type: viewType } }),
      label: 'createView',
    });
    return { view: res.data.view };
  }

  async deleteBitableView(appToken, tableId, viewId) {
    await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableView.delete({ path: { app_token: appToken, table_id: tableId, view_id: viewId } }),
      label: 'deleteView',
    });
    return { deleted: true };
  }

  async copyBitable(appToken, name, folderId) {
    const data = { name };
    if (folderId) data.folder_token = folderId;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/copy`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.bitable.app.copy({ path: { app_token: appToken }, data }),
      label: 'copyBitable',
    });
    return { app: res.data.app };
  }

  // --- Wiki ---

  async listWikiSpaces() {
    const res = await this._safeSDKCall(() => this.client.wiki.space.list({ params: { page_size: 50 } }), 'listSpaces');
    return { items: res.data.items || [] };
  }

  async searchWiki(query) {
    const res = await this._safeSDKCall(
      () => this.client.request({ method: 'POST', url: '/open-apis/suite/docs-api/search/object', data: { search_key: query, count: 20, offset: 0, owner_ids: [], chat_ids: [], docs_types: ['wiki'] } }),
      'searchWiki'
    );
    return { items: res.data.docs_entities || [] };
  }

  async getWikiNode(spaceId, nodeToken) {
    const res = await this._safeSDKCall(() => this.client.wiki.space.getNode({ params: { token: nodeToken } }), 'getNode');
    return res.data.node;
  }

  async listWikiNodes(spaceId, { parentNodeToken, pageToken } = {}) {
    const params = { page_size: 50 };
    if (parentNodeToken) params.parent_node_token = parentNodeToken;
    if (pageToken) params.page_token = pageToken;
    const res = await this._safeSDKCall(
      () => this.client.wiki.spaceNode.list({ path: { space_id: spaceId }, params }),
      'listNodes'
    );
    return { items: res.data.items || [], hasMore: res.data.has_more };
  }

  // --- Drive ---

  async listFiles(folderToken, { pageSize = 50, pageToken } = {}) {
    const params = { page_size: pageSize, folder_token: folderToken || '' };
    if (pageToken) params.page_token = pageToken;
    const res = await this._safeSDKCall(() => this.client.drive.file.list({ params }), 'listFiles');
    return { items: res.data.files || [], hasMore: res.data.has_more };
  }

  async createFolder(name, parentToken) {
    const body = { name, folder_token: parentToken || '' };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/drive/v1/files/create_folder`,
      method: 'POST',
      body,
      sdkFn: () => this.client.drive.file.createFolder({ data: body }),
      label: 'createFolder',
    });
    return { token: res.data.token, viaUser: !!res._viaUser };
  }

  // --- Drive: File Operations ---

  async copyFile(fileToken, name, folderToken, type) {
    const data = { name, folder_token: folderToken || '' };
    if (type) data.type = type;
    const res = await this._safeSDKCall(
      () => this.client.drive.file.copy({ path: { file_token: fileToken }, data }),
      'copyFile'
    );
    return { file: res.data.file };
  }

  async moveFile(fileToken, folderToken) {
    const res = await this._safeSDKCall(
      () => this.client.drive.file.move({ path: { file_token: fileToken }, data: { folder_token: folderToken || '' } }),
      'moveFile'
    );
    return { taskId: res.data.task_id };
  }

  async deleteFile(fileToken, type) {
    const res = await this._safeSDKCall(
      () => this.client.drive.file.delete({ path: { file_token: fileToken }, params: { type: type || 'file' } }),
      'deleteFile'
    );
    return { taskId: res.data.task_id };
  }

  // --- Contact ---

  async findUserByIdentity({ emails, mobiles } = {}) {
    const data = {};
    if (emails) data.emails = Array.isArray(emails) ? emails : [emails];
    if (mobiles) data.mobiles = Array.isArray(mobiles) ? mobiles : [mobiles];
    const res = await this._safeSDKCall(
      () => this.client.contact.user.batchGetId({ data, params: { user_id_type: 'open_id' } }),
      'findUser'
    );
    return { userList: res.data.user_list || [] };
  }

  // --- Chat ID Resolution ---

  async listAllChats() {
    const allChats = [];
    let pageToken;
    let hasMore = true;
    while (hasMore) {
      const res = await this._safeSDKCall(
        () => this.client.im.chat.list({ params: { page_size: 100, page_token: pageToken } }),
        'listAllChats'
      );
      allChats.push(...(res.data.items || []));
      pageToken = res.data.page_token;
      hasMore = res.data.has_more && !!pageToken;
    }
    return allChats;
  }

  // --- Safe SDK Call (extracts real Feishu error from AxiosError) ---

  async _safeSDKCall(fn, label = 'API') {
    try {
      const res = await fn();
      // SDK returns abbreviated responses for multipart uploads (code/msg undefined)
      // Only treat as error if code is explicitly non-zero
      if (res.code !== undefined && res.code !== 0) throw new Error(`${label} failed (${res.code}): ${res.msg}`);
      return res;
    } catch (err) {
      // Lark SDK uses axios; extract actual Feishu error from response body
      if (err.response?.data) {
        const d = err.response.data;
        const code = d.code ?? d.error ?? 'unknown';
        const msg = d.msg ?? d.error_description ?? d.message ?? JSON.stringify(d);
        throw new Error(`${label} failed (HTTP ${err.response.status}, code=${code}): ${msg}`);
      }
      throw err;
    }
  }

  // --- Chat Search (keyword-based, works even if bot isn't in the group's list) ---

  async chatSearch(query) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.search({ params: { query, page_size: 20 } }),
      'chatSearch'
    );
    return res.data.items || [];
  }

  // --- User Name Resolution ---

  async getUserById(userId, userIdType = 'open_id') {
    if (this._userNameCache.has(userId)) return this._userNameCache.get(userId);
    try {
      const res = await this.client.contact.user.get({
        path: { user_id: userId },
        params: { user_id_type: userIdType },
      });
      if (res.code === 0 && res.data?.user?.name) {
        this._userNameCache.set(userId, res.data.user.name);
        return res.data.user.name;
      }
    } catch {}
    return null;
  }

  async _populateSenderNames(items, userClient) {
    // Collect unique sender IDs that aren't cached
    const unknownIds = new Set();
    for (const item of items) {
      if (item.senderId && !this._userNameCache.has(item.senderId)) {
        unknownIds.add(item.senderId);
      }
    }
    // Parallel resolve via official contact API (instead of sequential N calls)
    if (unknownIds.size > 0) {
      await Promise.allSettled([...unknownIds].map(id => this.getUserById(id)));
    }
    // Fallback: resolve remaining unknowns via cookie-based user identity client
    if (userClient) {
      for (const id of unknownIds) {
        if (!this._userNameCache.has(id)) {
          try {
            const name = await userClient.getUserName(id);
            if (name) this._userNameCache.set(id, name);
          } catch {}
        }
      }
    }
    // Populate senderName field
    for (const item of items) {
      if (item.senderId) {
        item.senderName = this._userNameCache.get(item.senderId) || null;
      }
    }
  }

  // --- Helpers ---

  _formatMessage(m) {
    if (!m) return null;
    let body = m.body?.content || '';
    try { body = JSON.parse(body); } catch {}
    const out = {
      messageId: m.message_id,
      chatId: m.chat_id,
      senderId: m.sender?.id,
      senderType: m.sender?.sender_type,
      msgType: m.msg_type,
      content: body,
      createTime: this._normalizeTimestamp(m.create_time),
      updateTime: this._normalizeTimestamp(m.update_time),
    };
    if (Array.isArray(m.mentions) && m.mentions.length > 0) out.mentions = m.mentions;
    return out;
  }

  _normalizeTimestamp(ts) {
    if (!ts) return null;
    const n = parseInt(ts);
    // Feishu returns millisecond strings; normalize to seconds
    return String(n > 1e12 ? Math.floor(n / 1000) : n);
  }
}

module.exports = { LarkOfficialClient };
