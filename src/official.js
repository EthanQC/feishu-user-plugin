const lark = require('@larksuiteoapi/node-sdk');
const { fetchWithTimeout } = require('./utils');
const { classifyError } = require('./error-codes');
const { buildEmptyImageBlock, buildReplaceImagePayload } = require('./doc-blocks');

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
      // 99991668 is overloaded: "invalid token" (→ refresh helps) vs
      // "endpoint doesn't support UAT at all" (→ refresh is pointless, and
      // worse, it consumes a one-shot refresh_token rotation). The second
      // case is identifiable by the msg "user access token not support" or
      // "not support". If so, surface the code to the caller without refresh.
      if (data.code === 99991668 && typeof data.msg === 'string' && /not support/i.test(data.msg)) {
        return data;
      }
      // Token invalid/expired — try refresh once
      uat = await this._refreshUAT();
      return fn(uat);
    }
    return data;
  }

  // Generic UAT REST helper. Returns parsed JSON ({code, msg, data}).
  // Array query values are expanded to repeated keys (period_ids=a&period_ids=b)
  // because several Feishu endpoints (OKR, calendar) rely on that convention.
  async _uatREST(method, path, { body, query } = {}) {
    let qs = '';
    if (query) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) { for (const item of v) sp.append(k, String(item)); }
        else sp.append(k, String(v));
      }
      const str = sp.toString();
      if (str) qs = '?' + str;
    }
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
  //
  // When BOTH paths fail (common for OKR/Calendar if neither UAT nor app has the scope),
  // the final error includes the UAT-side reason too, so the user can tell whether they
  // need a new OAuth (UAT missing scope) or a different app (app missing scope).
  async _asUserOrApp({ uatPath, method = 'GET', body, query, sdkFn, label }) {
    let uatSummary = null;
    if (this.hasUAT) {
      try {
        const data = await this._uatREST(method, uatPath, { body, query });
        if (data.code === 0) {
          data._viaUser = true;
          return data;
        }
        uatSummary = `as user: code=${data.code} msg=${data.msg}`;
        console.error(`[feishu-user-plugin] ${label} ${uatSummary}, retrying as app`);
      } catch (err) {
        uatSummary = `as user: ${err.message}`;
        console.error(`[feishu-user-plugin] ${label} as user threw (${err.message}), retrying as app`);
      }
    }
    try {
      const appData = await this._safeSDKCall(sdkFn, label);
      if (appData && typeof appData === 'object') appData._viaUser = false;
      return appData;
    } catch (appErr) {
      if (uatSummary) {
        const err = new Error(`${label} failed on both identities. ${uatSummary}. as app: ${appErr.message}`);
        err.uatSummary = uatSummary;
        err.appError = appErr;
        throw err;
      }
      throw appErr;
    }
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

  async createDoc(title, folderId, { wikiSpaceId, wikiParentNodeToken } = {}) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents`,
      method: 'POST',
      body: { title, folder_token: folderId || '' },
      sdkFn: () => this.client.docx.document.create({ data: { title, folder_token: folderId || '' } }),
      label: 'createDoc',
    });
    const documentId = res.data.document?.document_id;
    const out = { documentId, viaUser: !!res._viaUser };
    if (documentId && wikiSpaceId) {
      try {
        const node = await this.attachToWiki(wikiSpaceId, 'docx', documentId, wikiParentNodeToken);
        if (node?.node_token) out.wikiNodeToken = node.node_token;
        else if (node?.task_id) out.wikiAttachTaskId = node.task_id;
      } catch (e) {
        out.wikiAttachError = e.message;
      }
    }
    return out;
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

  async createBitable(name, folderId, { wikiSpaceId, wikiParentNodeToken } = {}) {
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
    const appToken = res.data.app?.app_token;
    const out = { appToken, name: res.data.app?.name, url: res.data.app?.url, viaUser: !!res._viaUser };
    if (appToken && wikiSpaceId) {
      try {
        const node = await this.attachToWiki(wikiSpaceId, 'bitable', appToken, wikiParentNodeToken);
        if (node?.node_token) out.wikiNodeToken = node.node_token;
        else if (node?.task_id) out.wikiAttachTaskId = node.task_id;
      } catch (e) {
        out.wikiAttachError = e.message;
      }
    }
    return out;
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

  // Resolves a wiki node token to its underlying object (docx / sheet / bitable / ...).
  // `spaceId` argument is kept for backward compatibility but isn't used — the Feishu
  // endpoint `wiki.v2.getNode` takes only the token.
  async getWikiNode(nodeToken, _spaceId) {
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

  // --- Hardened Message Read (v1.3.4) ---

  // Reads messages with explicit fallback routing: tries the bot path first,
  // classifies any failure via error-codes.js, and escalates to UAT when
  // appropriate. Returns the same shape as readMessages/readMessagesAsUser
  // plus `via` ('bot' | 'user' | 'contacts') and, if fallback fired,
  // `via_reason` (a short enum from classifyError).
  //
  // If `skipBot` is true, the bot path is never attempted (callers use this
  // when the chat_id came from search_contacts — i.e. definitely external).
  //
  // Throws a single, wrapped error if BOTH paths fail or if UAT is absent and
  // the bot failed; the message points the user at `npx feishu-user-plugin oauth`.
  async readMessagesWithFallback(chatId, options, userClient, { skipBot = false, via = 'bot' } = {}) {
    const tryUAT = async (viaLabel, reason) => {
      if (!this.hasUAT) {
        const hint = 'To read external / private groups, configure UAT via: npx feishu-user-plugin oauth';
        const err = new Error(`Cannot read chat ${chatId} as bot (${reason || 'bot failed and no UAT configured'}). ${hint}`);
        err.viaReason = reason;
        throw err;
      }
      const data = await this.readMessagesAsUser(chatId, options, userClient);
      data.via = viaLabel;
      if (reason) data.via_reason = reason;
      return data;
    };

    if (skipBot) {
      return tryUAT(via || 'contacts', 'contacts_resolved_external');
    }

    // Attempt 1 — bot identity.
    try {
      const data = await this.readMessages(chatId, options, userClient);
      data.via = 'bot';
      return data;
    } catch (botErr) {
      const klass = classifyError(botErr);
      console.error(`[feishu-user-plugin] read_messages bot failed for ${chatId}: ${botErr.message} [class=${klass.action}, reason=${klass.reason}, code=${klass.code}]`);

      if (klass.action === 'retry') {
        // One retry after short backoff before hopping to UAT.
        await new Promise(r => setTimeout(r, 2000));
        try {
          const data = await this.readMessages(chatId, options, userClient);
          data.via = 'bot';
          data.via_reason = klass.reason + '_recovered';
          return data;
        } catch (retryErr) {
          console.error(`[feishu-user-plugin] read_messages bot retry failed for ${chatId}: ${retryErr.message}`);
        }
      }

      // Fall through to UAT — if UAT is missing, tryUAT throws the user-friendly
      // "run npx feishu-user-plugin oauth" error instead of the raw Feishu payload.
      return tryUAT('user', klass.reason);
    }
  }

  // --- Docx Image Read (v1.3.4) ---

  // Download a media asset (image, file, etc.) referenced from inside a Feishu
  // docx block. The model actually gets the pixels via MCP image content in the
  // handler layer; here we just return base64 + metadata.
  //
  // Feishu's drive/v1/medias/{token}/download requires a query `extra` with
  // a JSON-encoded doc_token when the media lives inside a doc (to pass
  // tenant-scoped auth). Passing extra is harmless for generic drive files.
  async downloadDocImage(imageToken, docToken, docType = 'docx') {
    if (!imageToken) throw new Error('downloadDocImage: imageToken is required');
    // Feishu's drive media download uses `extra` as a JSON-string query param to
    // identify the enclosing doc context. Most observed forms carry both
    // `doc_type` and `doc_token`; omitting docType falls back to 'docx' which
    // is the by-far most common case. Omitting extra entirely is safe for
    // standalone drive-media tokens that don't live inside a doc.
    const extra = docToken
      ? `?extra=${encodeURIComponent(JSON.stringify({ doc_type: docType, doc_token: docToken }))}`
      : '';
    const path = `/open-apis/drive/v1/medias/${encodeURIComponent(imageToken)}/download${extra}`;
    const url = 'https://open.feishu.cn' + path;

    // Attempt 1 — user identity (most reliable for user-owned docs).
    if (this.hasUAT) {
      try {
        const uat = await this._getValidUAT();
        const res = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${uat}` }, timeoutMs: 60000 });
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
        console.error(`[feishu-user-plugin] downloadDocImage as user failed: ${errJson?.code}: ${errJson?.msg || res.statusText}, retrying as app`);
      } catch (e) {
        console.error(`[feishu-user-plugin] downloadDocImage as user threw (${e.message}), retrying as app`);
      }
    }

    // Attempt 2 — app identity. Requires the app to have drive access to the doc.
    const token = await this._getAppToken();
    const res = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` }, timeoutMs: 60000 });
    if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
      const errJson = await res.json().catch(() => null);
      throw new Error(`downloadDocImage failed: ${errJson?.code}: ${errJson?.msg || res.statusText}. Note: app identity requires drive access to the document; configure UAT for user-owned docs.`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      base64: buf.toString('base64'),
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
      bytes: buf.length,
      viaUser: false,
    };
  }

  // --- Docx Image Write (v1.3.4) ---

  // Upload binary media (typically an image) to Feishu's drive layer so it can
  // be attached to a docx block. Returns the media's file_token, which is what
  // the image block's `replace_image.token` expects.
  //
  // parentType = 'docx_image' for doc-embedded images (most common).
  // parentNode = the block_id of the image placeholder (NOT the document_id).
  async uploadDocMedia(filePath, parentNode, parentType = 'docx_image') {
    const fs = require('fs');
    const path = require('path');
    if (!filePath) throw new Error('uploadDocMedia: filePath is required');
    if (!parentNode) throw new Error('uploadDocMedia: parentNode (block_id) is required');

    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const buf = fs.readFileSync(filePath);

    // Best-effort content-type from extension. Feishu doesn't require it but
    // some CDNs behind the API key off it; the Blob default is text/plain
    // which would look wrong for binary images.
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.ico': 'image/x-icon',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    const doUpload = async (bearer) => {
      const form = new FormData();
      form.append('file_name', fileName);
      form.append('parent_type', parentType);
      form.append('parent_node', parentNode);
      form.append('size', String(stat.size));
      form.append('file', new Blob([buf], { type: contentType }), fileName);
      const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${bearer}` },
        body: form,
        timeoutMs: 120000,
      });
      return res.json();
    };

    // User identity first — docx_image usually belongs to a user-owned doc.
    if (this.hasUAT) {
      try {
        const data = await this._withUAT(doUpload);
        if (data.code === 0 && data.data?.file_token) {
          return { fileToken: data.data.file_token, viaUser: true };
        }
        console.error(`[feishu-user-plugin] uploadDocMedia as user failed (${data.code}: ${data.msg}), retrying as app`);
      } catch (e) {
        console.error(`[feishu-user-plugin] uploadDocMedia as user threw (${e.message}), retrying as app`);
      }
    }
    const appToken = await this._getAppToken();
    const data = await doUpload(appToken);
    if (data.code !== 0 || !data.data?.file_token) {
      throw new Error(`uploadDocMedia failed: ${data.code}: ${data.msg || 'no file_token returned'}`);
    }
    return { fileToken: data.data.file_token, viaUser: false };
  }

  // Create a new image block and populate it from either a local file path or
  // an already-uploaded media token. Orchestrates the three-step Feishu flow:
  //   1) create empty image placeholder block
  //   2) upload pixels (skipped if caller passes a ready-made imageToken)
  //   3) patch the placeholder with the uploaded token
  // Returns { blockId, imageToken, viaUser }.
  async createDocBlockWithImage(documentId, parentBlockId, { imagePath, imageToken, index } = {}) {
    if (!imagePath && !imageToken) {
      throw new Error('createDocBlockWithImage: either imagePath or imageToken is required');
    }

    // Step 1 — empty placeholder.
    const placeholder = buildEmptyImageBlock();
    const createBody = { children: [placeholder] };
    if (index !== undefined) createBody.index = index;
    const created = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
      method: 'POST',
      body: createBody,
      sdkFn: () => this.client.docx.documentBlockChildren.create({
        path: { document_id: documentId, block_id: parentBlockId },
        data: createBody,
      }),
      label: 'createDocBlockWithImage.placeholder',
    });
    const newBlock = (created.data.children || [])[0];
    const blockId = newBlock?.block_id;
    if (!blockId) throw new Error(`createDocBlockWithImage: placeholder creation returned no block_id: ${JSON.stringify(created.data).slice(0, 400)}`);

    // Step 2 — upload (if needed).
    let finalToken = imageToken;
    let viaUser = !!created._viaUser;
    if (!finalToken) {
      const uploaded = await this.uploadDocMedia(imagePath, blockId, 'docx_image');
      finalToken = uploaded.fileToken;
      viaUser = viaUser && uploaded.viaUser; // true iff both steps went via user
    }

    // Step 3 — attach token to the placeholder via PATCH replace_image.
    const patch = buildReplaceImagePayload(finalToken);
    await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
      method: 'PATCH',
      body: patch,
      sdkFn: () => this.client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: blockId },
        data: patch,
      }),
      label: 'createDocBlockWithImage.replaceImage',
    });

    return { blockId, imageToken: finalToken, viaUser };
  }

  // Replace an existing image block's media token (e.g. swap the picture in an
  // already-created image block). Expects an uploaded media token — use
  // uploadDocMedia or create_doc_block's image_path shortcut to obtain one.
  async updateDocBlockImage(documentId, blockId, imageToken) {
    const patch = buildReplaceImagePayload(imageToken);
    await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
      method: 'PATCH',
      body: patch,
      sdkFn: () => this.client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: blockId },
        data: patch,
      }),
      label: 'updateDocBlockImage',
    });
    return { blockId, imageToken };
  }

  // --- Wiki attach (v1.3.4) ---

  // Move an existing drive resource (docx / bitable / sheet / ...) into a Wiki
  // space as an 'origin' node. Used by createDoc / createBitable when their
  // wikiSpaceId option is set.
  //
  // Uses wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki — the documented path
  // for migrating an existing drive doc into wiki. Note: this endpoint is async;
  // if the move completes immediately (typical for newly-created docs) we get
  // back a wiki_token and surface it as node_token. If it's queued we return
  // { task_id } so the caller can see the async state — we don't currently poll.
  async attachToWiki(spaceId, objType, objToken, parentNodeToken) {
    if (!spaceId) throw new Error('attachToWiki: spaceId is required');
    if (!objType) throw new Error('attachToWiki: objType is required');
    if (!objToken) throw new Error('attachToWiki: objToken is required');
    const body = { obj_type: objType, obj_token: objToken, apply: true };
    if (parentNodeToken) body.parent_wiki_token = parentNodeToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/move_docs_to_wiki`,
      method: 'POST',
      body,
      sdkFn: () => this.client.wiki.spaceNode.moveDocsToWiki({ path: { space_id: spaceId }, data: body }),
      label: 'attachToWiki',
    });
    const data = res.data || {};
    if (data.wiki_token) return { node_token: data.wiki_token, applied: !!data.applied };
    if (data.task_id) return { task_id: data.task_id, applied: false };
    return data;
  }

  // --- OKR (v1.3.4) ---

  async listUserOkrs(userId, { periodIds, offset = 0, limit = 10, lang, userIdType = 'open_id' } = {}) {
    if (!userId) throw new Error('listUserOkrs: userId is required (the user whose OKRs to read). For your own, get your open_id from get_login_status or search_contacts.');
    const params = { user_id_type: userIdType, offset: String(offset), limit: String(limit) };
    if (lang) params.lang = lang;
    if (periodIds && periodIds.length) params.period_ids = periodIds;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/okr/v1/users/${encodeURIComponent(userId)}/okrs`,
      query: params,
      sdkFn: () => this.client.okr.userOkr.list({
        path: { user_id: userId },
        params: {
          user_id_type: userIdType,
          offset: String(offset),
          limit: String(limit),
          ...(lang ? { lang } : {}),
          ...(periodIds && periodIds.length ? { period_ids: periodIds } : {}),
        },
      }),
      label: 'listUserOkrs',
    });
    return { total: res.data.total, items: res.data.okr_list || [] };
  }

  async getOkrs(okrIds, { lang, userIdType = 'open_id' } = {}) {
    if (!Array.isArray(okrIds) || okrIds.length === 0) {
      throw new Error('getOkrs: okrIds must be a non-empty array');
    }
    const params = { user_id_type: userIdType, okr_ids: okrIds };
    if (lang) params.lang = lang;
    // UAT REST path takes repeated okr_ids= params; URLSearchParams will serialize an array properly
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/okr/v1/okrs/batch_get`,
      query: params,
      sdkFn: () => this.client.okr.okr.batchGet({ params }),
      label: 'getOkrs',
    });
    return { items: res.data.okr_list || [] };
  }

  async listOkrPeriods({ pageSize = 10, pageToken } = {}) {
    const params = { page_size: String(pageSize) };
    if (pageToken) params.page_token = pageToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/okr/v1/periods`,
      query: params,
      sdkFn: () => this.client.okr.period.list({ params: { page_size: pageSize, ...(pageToken ? { page_token: pageToken } : {}) } }),
      label: 'listOkrPeriods',
    });
    return { items: res.data.items || [], pageToken: res.data.page_token, hasMore: res.data.has_more };
  }

  // --- Calendar (v1.3.4) ---

  async listCalendars({ pageSize = 50, pageToken, syncToken } = {}) {
    // Feishu's calendar/v4/calendars endpoint rejects page_size < 50 with
    // `99992402 field validation failed` ("the min value is 50"). The docs don't
    // flag this — smoke-tested against the real API. Clamp to be safe.
    const ps = Math.max(50, Number(pageSize) || 50);
    const params = { page_size: String(ps) };
    if (pageToken) params.page_token = pageToken;
    if (syncToken) params.sync_token = syncToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars`,
      query: params,
      sdkFn: () => this.client.calendar.calendar.list({ params: { page_size: ps, ...(pageToken ? { page_token: pageToken } : {}), ...(syncToken ? { sync_token: syncToken } : {}) } }),
      label: 'listCalendars',
    });
    return {
      items: res.data.calendar_list || [],
      pageToken: res.data.page_token,
      syncToken: res.data.sync_token,
      hasMore: res.data.has_more,
    };
  }

  async listCalendarEvents(calendarId, { startTime, endTime, pageSize = 50, pageToken, syncToken } = {}) {
    if (!calendarId) throw new Error('listCalendarEvents: calendarId is required');
    const params = { page_size: String(pageSize) };
    if (startTime) params.start_time = String(startTime);
    if (endTime) params.end_time = String(endTime);
    if (pageToken) params.page_token = pageToken;
    if (syncToken) params.sync_token = syncToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
      query: params,
      sdkFn: () => this.client.calendar.calendarEvent.list({
        path: { calendar_id: calendarId },
        params: {
          page_size: pageSize,
          ...(startTime ? { start_time: String(startTime) } : {}),
          ...(endTime ? { end_time: String(endTime) } : {}),
          ...(pageToken ? { page_token: pageToken } : {}),
          ...(syncToken ? { sync_token: syncToken } : {}),
        },
      }),
      label: 'listCalendarEvents',
    });
    return {
      items: res.data.items || [],
      pageToken: res.data.page_token,
      syncToken: res.data.sync_token,
      hasMore: res.data.has_more,
    };
  }

  async getCalendarEvent(calendarId, eventId) {
    if (!calendarId || !eventId) throw new Error('getCalendarEvent: calendarId and eventId are required');
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      sdkFn: () => this.client.calendar.calendarEvent.get({ path: { calendar_id: calendarId, event_id: eventId } }),
      label: 'getCalendarEvent',
    });
    return { event: res.data.event };
  }
}

module.exports = { LarkOfficialClient };
