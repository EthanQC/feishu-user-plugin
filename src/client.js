const path = require('path');
const protobuf = require('protobufjs');
const { generateRequestId, generateCid, parseCookie, formatCookie, fetchWithTimeout } = require('./utils');

const GATEWAY_URL = 'https://internal-api-lark-api.feishu.cn/im/gateway/';
const CSRF_URL = 'https://internal-api-lark-api.feishu.cn/accounts/csrf';
const USER_INFO_URL = 'https://internal-api-lark-api.feishu.cn/accounts/web/user';

// Message type enum (matches proto)
const MsgType = { POST: 2, FILE: 3, TEXT: 4, IMAGE: 5, AUDIO: 7, STICKER: 10, MEDIA: 15 };

class LarkUserClient {
  constructor(cookieStr) {
    // Validate cookie: HTTP headers require all characters ≤ 255 (ByteString).
    // Users sometimes accidentally include Chinese text when copying cookies from browser.
    const nonAsciiMatch = cookieStr.match(/[^\x00-\xff]/);
    if (nonAsciiMatch) {
      const idx = cookieStr.indexOf(nonAsciiMatch[0]);
      const context = cookieStr.substring(Math.max(0, idx - 20), idx + 20);
      throw new Error(
        `LARK_COOKIE contains non-ASCII character "${nonAsciiMatch[0]}" (U+${nonAsciiMatch[0].charCodeAt(0).toString(16).toUpperCase()}) at index ${idx}.\n` +
        `Context: ...${context}...\n` +
        'This usually means extra text was accidentally copied with the cookie.\n' +
        'Fix: In DevTools Network tab → first request → Request Headers → Cookie → copy ONLY the cookie value.'
      );
    }
    this.cookieObj = parseCookie(cookieStr);
    this.cookieStr = cookieStr;
    this.csrfToken = null;
    this.userId = null;
    this.userName = null;
    this.proto = null;
    this._heartbeatTimer = null;
  }

  async init() {
    this.proto = await protobuf.load(path.join(__dirname, '..', 'proto', 'lark.proto'));
    await this._getCsrfToken();
    await this._getUserInfo();
    if (!this.userId) {
      throw new Error('Failed to authenticate. Cookie may be expired — re-login at feishu.cn and update LARK_COOKIE.');
    }
    console.error(`[feishu-user-plugin] Initialized as user: ${this.userName || this.userId}`);
    this._startHeartbeat();
  }

  // --- Auth ---

  async _getCsrfToken() {
    const res = await fetchWithTimeout(`${CSRF_URL}?_t=${Date.now()}`, {
      method: 'POST',
      headers: {
        ...this._jsonHeaders(),
        'x-request-id': generateRequestId(),
      },
    });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      const csrf = c.match(/swp_csrf_token=([^;]+)/);
      if (csrf) { this.csrfToken = csrf[1]; this.cookieObj['swp_csrf_token'] = csrf[1]; }
      const sl = c.match(/sl_session=([^;]+)/);
      if (sl) { this.cookieObj['sl_session'] = sl[1]; }
    }
    this.cookieStr = formatCookie(this.cookieObj);
    if (!this.csrfToken) {
      console.error('[feishu-user-plugin] Warning: Could not obtain CSRF token');
    }
  }

  async _getUserInfo() {
    const res = await fetchWithTimeout(`${USER_INFO_URL}?app_id=12&_t=${Date.now()}`, {
      headers: {
        ...this._jsonHeaders(),
        'x-csrf-token': this.csrfToken || '',
        'x-request-id': generateRequestId(),
      },
    });
    const body = await res.json().catch(() => null);
    if (body?.data?.user?.id) {
      this.userId = String(body.data.user.id);
      this.userName = body.data.user.name || null;
    }
  }

  // --- Cookie Heartbeat ---

  _startHeartbeat() {
    // Refresh CSRF token every 4 hours to keep session alive
    // Feishu sl_session has 12h max-age; CSRF refresh also refreshes sl_session
    this._heartbeatTimer = setInterval(async () => {
      try {
        await this._getCsrfToken();
        // Lazy require to avoid circular dependency at module load time
        const { persistToConfig } = require('./config');
        persistToConfig({ LARK_COOKIE: this.cookieStr });
        console.error('[feishu-user-plugin] Cookie heartbeat: session refreshed and persisted');
      } catch (e) {
        console.error('[feishu-user-plugin] Cookie heartbeat failed:', e.message);
      }
    }, 4 * 60 * 60 * 1000); // 4 hours
    // Don't keep the process alive just for heartbeat
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  async checkSession() {
    try {
      await this._getCsrfToken();
      await this._getUserInfo();
      return {
        valid: !!this.userId,
        userId: this.userId,
        userName: this.userName,
        message: this.userId ? 'Session active' : 'Session expired — re-login required',
      };
    } catch (e) {
      return { valid: false, message: `Session check failed: ${e.message}` };
    }
  }

  // --- Headers ---

  _baseHeaders() {
    return {
      'accept-language': 'zh-CN,zh;q=0.9',
      'cookie': this.cookieStr,
      'origin': 'https://www.feishu.cn',
      'referer': 'https://www.feishu.cn/',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
  }

  _jsonHeaders() {
    return {
      ...this._baseHeaders(),
      'accept': 'application/json, text/plain, */*',
      'x-app-id': '12',
      'x-api-version': '2',
      'x-device-info': 'platform=websdk',
      'x-lgw-os-type': '1',
      'x-lgw-terminal-type': '2',
      'x-terminal-type': '2',
    };
  }

  _protoHeaders(cmd, cmdVersion = '2.7.0') {
    return {
      ...this._baseHeaders(),
      'accept': '*/*',
      'content-type': 'application/x-protobuf',
      'locale': 'zh_CN',
      'x-appid': '161471',
      'x-command': String(cmd),
      'x-command-version': cmdVersion,
      'x-lgw-os-type': '1',
      'x-lgw-terminal-type': '2',
      'x-request-id': generateRequestId(),
      'x-source': 'web',
      'x-web-version': '3.9.32',
    };
  }

  // --- Protobuf Helpers ---

  _encode(typeName, data) {
    const Type = this.proto.lookupType(typeName);
    return Type.encode(Type.create(data)).finish();
  }

  _decode(typeName, buffer) {
    const Type = this.proto.lookupType(typeName);
    return Type.decode(buffer);
  }

  async _gateway(cmd, reqType, reqData, cmdVersion) {
    const reqBuf = this._encode(reqType, reqData);
    const packetBuf = this._encode('Packet', {
      payloadType: 1,
      cmd,
      cid: generateRequestId(),
      payload: reqBuf,
    });
    const res = await fetchWithTimeout(GATEWAY_URL, {
      method: 'POST',
      headers: this._protoHeaders(cmd, cmdVersion),
      body: packetBuf,
    });
    const resBuf = Buffer.from(await res.arrayBuffer());
    return { packet: this._decode('Packet', resBuf), ok: res.ok };
  }

  // --- Generic Send (cmd=5) ---

  async _sendMsg(type, chatId, content, { rootId, parentId } = {}) {
    const req = { type, chatId, cid: generateCid(), isNotified: true, version: 1, content };
    if (rootId) req.rootId = rootId;
    if (parentId) req.parentId = parentId;
    const { packet, ok } = await this._gateway(5, 'PutMessageRequest', req, '5.7.0');
    return { success: ok && (packet.status === 0 || packet.status == null), status: packet.status };
  }

  // --- Send Text Message ---

  // Supports inline @mentions via the `ats` param:
  //   ats: [{ userId: 'ou_xxx', name: 'Alice' }]
  // The text should contain the mention markers (defaults to `@Alice` substrings,
  // matched in order). If `text` already contains the @Name substrings, they're
  // found in order and spliced into rich-text AT elements.
  async sendMessage(chatId, text, opts = {}) {
    const { ats } = opts;
    if (!Array.isArray(ats) || ats.length === 0) {
      // Fast path: plain text, single TEXT element.
      const elemId = generateCid();
      const textPropBuf = this._encode('TextProperty', { content: text });
      return this._sendMsg(MsgType.TEXT, chatId, {
        richText: {
          elementIds: [elemId],
          innerText: text,
          elements: { dictionary: { [elemId]: { tag: 1, property: textPropBuf } } },
        },
      }, opts);
    }

    // Build rich-text segments: split `text` by each at's display marker and
    // weave AT elements in between text elements. Each `ats[i]` is consumed
    // in order from the remaining text.
    const elementIds = [];
    const atIds = [];
    const dictionary = {};
    let remaining = text;
    for (const at of ats) {
      if (!at.userId) throw new Error('sendMessage: each at entry requires userId');
      const display = at.marker || (at.name ? '@' + at.name : '@' + at.userId);
      const idx = remaining.indexOf(display);
      if (idx === -1) throw new Error(`sendMessage: marker "${display}" not found in text`);
      const before = remaining.slice(0, idx);
      if (before) {
        const id = generateCid();
        elementIds.push(id);
        dictionary[id] = { tag: 1, property: this._encode('TextProperty', { content: before }) };
      }
      const atId = generateCid();
      elementIds.push(atId);
      atIds.push(atId);
      dictionary[atId] = {
        tag: 5,
        property: this._encode('AtProperty', { userId: at.userId, content: display }),
      };
      remaining = remaining.slice(idx + display.length);
    }
    if (remaining) {
      const id = generateCid();
      elementIds.push(id);
      dictionary[id] = { tag: 1, property: this._encode('TextProperty', { content: remaining }) };
    }

    return this._sendMsg(MsgType.TEXT, chatId, {
      richText: {
        elementIds,
        innerText: text,
        elements: { dictionary },
        atIds,
      },
    }, opts);
  }

  // --- Send Image ---

  async sendImage(chatId, imageKey, opts = {}) {
    return this._sendMsg(MsgType.IMAGE, chatId, { imageKey }, opts);
  }

  // --- Send File ---

  async sendFile(chatId, fileKey, fileName, opts = {}) {
    return this._sendMsg(MsgType.FILE, chatId, { fileKey, fileName }, opts);
  }

  // --- Send Audio ---

  async sendAudio(chatId, audioKey, opts = {}) {
    return this._sendMsg(MsgType.AUDIO, chatId, { audioKey }, opts);
  }

  // --- Send Sticker ---

  async sendSticker(chatId, stickerId, stickerSetId, opts = {}) {
    return this._sendMsg(MsgType.STICKER, chatId, { stickerId, stickerSetId }, opts);
  }

  // --- Send Rich Text / POST ---

  async sendPost(chatId, title, paragraphs, opts = {}) {
    const elementIds = [];
    const atIds = [];
    const anchorIds = [];
    const dictionary = {};
    const paraTexts = [];

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const paraTextParts = [];
      for (const elem of para) {
        const elemId = generateCid();
        elementIds.push(elemId);

        if (elem.tag === 'text') {
          const t = elem.text || '';
          const propBuf = this._encode('TextProperty', { content: t });
          dictionary[elemId] = { tag: 1, property: propBuf };
          paraTextParts.push(t);
        } else if (elem.tag === 'at') {
          if (!elem.userId) throw new Error('sendPost: {tag:"at"} requires userId');
          const displayName = elem.name || elem.userName || elem.text || elem.userId;
          const display = displayName.startsWith('@') ? displayName : `@${displayName}`;
          const propBuf = this._encode('AtProperty', { userId: elem.userId, content: display });
          dictionary[elemId] = { tag: 5, property: propBuf };
          atIds.push(elemId);
          paraTextParts.push(display);
        } else if (elem.tag === 'a') {
          const href = elem.href || '';
          const label = elem.text || href;
          const propBuf = this._encode('AnchorProperty', { href, content: label, textContent: label });
          dictionary[elemId] = { tag: 6, property: propBuf };
          anchorIds.push(elemId);
          paraTextParts.push(label);
        } else {
          throw new Error(`sendPost: unknown element tag "${elem.tag}" (supported: text, at, a)`);
        }
      }
      paraTexts.push(paraTextParts.join(''));
      // Insert newline element between paragraphs
      if (i < paragraphs.length - 1) {
        const nlId = generateCid();
        elementIds.push(nlId);
        const propBuf = this._encode('TextProperty', { content: '\n' });
        dictionary[nlId] = { tag: 1, property: propBuf };
      }
    }

    const innerText = paraTexts.join('\n');
    const richText = { elementIds, innerText, elements: { dictionary } };
    if (atIds.length > 0) richText.atIds = atIds;
    if (anchorIds.length > 0) richText.anchorIds = anchorIds;
    return this._sendMsg(MsgType.POST, chatId, {
      title: title || '',
      richText,
    }, opts);
  }

  // --- Search (cmd=11021) ---

  async search(query) {
    const { packet } = await this._gateway(11021, 'UniversalSearchRequest', {
      header: {
        searchSession: generateCid(),
        sessionSeqId: 1,
        query,
        locale: 'zh_CN',
        searchContext: {
          tagName: 'SMART_SEARCH',
          entityItems: [
            { type: 1 },
            { type: 2 },
            { type: 3, filter: { groupChatFilter: {} } },
          ],
          commonFilter: { includeOuterTenant: true },
          sourceKey: 'messenger',
        },
      },
    });

    if (!packet.payload) return [];
    const searchRes = this._decode('UniversalSearchResponse', packet.payload);
    const items = (searchRes.results || []).map((r) => ({
      id: r.id,
      type: r.type === 1 ? 'user' : r.type === 3 ? 'group' : 'bot',
      title: r.titleHighlighted?.replace(/<[^>]+>/g, '') || '',
      summary: r.summaryHighlighted?.replace(/<[^>]+>/g, '') || '',
    }));
    // Cache names for getUserName lookups
    for (const item of items) {
      if (item.title) this._nameCache.set(String(item.id), item.title);
    }
    return items;
  }

  // --- Create P2P Chat (cmd=13) ---

  async createChat(userId) {
    const { packet } = await this._gateway(13, 'PutChatRequest', {
      type: 1,
      chatterIds: [userId],
    });

    if (!packet.payload) return null;
    const chatRes = this._decode('PutChatResponse', packet.payload);
    return chatRes.chat?.id || null;
  }

  // --- Get Group Info (cmd=64) ---

  async getGroupInfo(chatId) {
    const { packet } = await this._gateway(64, 'GetGroupInfoRequest', { chatId });

    if (!packet.payload) return null;
    const res = this._decode('GetGroupInfoResponse', packet.payload);
    const chat = res.chat;
    if (!chat) return null;
    return {
      id: chat.id,
      name: chat.name || '',
      description: chat.description || '',
      type: chat.type === 1 ? 'p2p' : chat.type === 2 ? 'group' : chat.type === 3 ? 'topic_group' : 'unknown',
      memberCount: chat.memberCount || chat.userCount || 0,
      ownerId: chat.ownerId || '',
      isPublic: !!chat.isPublic,
      isDissolved: !!chat.isDissolved,
      createTime: chat.createTime ? Number(chat.createTime) : null,
    };
  }

  // --- Get User Name ---

  // Name cache populated by search() and init()
  _nameCache = new Map();

  async getUserName(userId) {
    // Check cache first (populated by search, init, and previous lookups)
    if (this._nameCache.has(String(userId))) return this._nameCache.get(String(userId));
    // Self
    if (String(userId) === String(this.userId) && this.userName) {
      this._nameCache.set(String(userId), this.userName);
      return this.userName;
    }
    return null;
  }
}

module.exports = { LarkUserClient, MsgType };
