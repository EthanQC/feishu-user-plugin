const path = require('path');
const protobuf = require('protobufjs');
const { generateRequestId, generateCid, parseCookie, formatCookie } = require('./utils');

const GATEWAY_URL = 'https://internal-api-lark-api.feishu.cn/im/gateway/';
const CSRF_URL = 'https://internal-api-lark-api.feishu.cn/accounts/csrf';
const USER_INFO_URL = 'https://internal-api-lark-api.feishu.cn/accounts/web/user';

// Message type enum (matches proto)
const MsgType = { POST: 2, FILE: 3, TEXT: 4, IMAGE: 5, AUDIO: 7, STICKER: 10, MEDIA: 15 };

class LarkUserClient {
  constructor(cookieStr) {
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
    console.error(`[feishu-user-mcp] Initialized as user: ${this.userName || this.userId}`);
    this._startHeartbeat();
  }

  // --- Auth ---

  async _getCsrfToken() {
    const res = await fetch(`${CSRF_URL}?_t=${Date.now()}`, {
      method: 'POST',
      headers: {
        ...this._jsonHeaders(),
        'x-request-id': generateRequestId(),
      },
    });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      const match = c.match(/swp_csrf_token=([^;]+)/);
      if (match) {
        this.csrfToken = match[1];
        this.cookieObj['swp_csrf_token'] = match[1];
        this.cookieStr = formatCookie(this.cookieObj);
        break;
      }
    }
    // Also capture refreshed sl_session if present
    for (const c of setCookie) {
      const match = c.match(/sl_session=([^;]+)/);
      if (match) {
        this.cookieObj['sl_session'] = match[1];
        this.cookieStr = formatCookie(this.cookieObj);
        break;
      }
    }
    if (!this.csrfToken) {
      console.error('[feishu-user-mcp] Warning: Could not obtain CSRF token');
    }
  }

  async _getUserInfo() {
    const res = await fetch(`${USER_INFO_URL}?app_id=12&_t=${Date.now()}`, {
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
        console.error('[feishu-user-mcp] Cookie heartbeat: session refreshed');
      } catch (e) {
        console.error('[feishu-user-mcp] Cookie heartbeat failed:', e.message);
      }
    }, 4 * 60 * 60 * 1000); // 4 hours
    // Don't keep the process alive just for heartbeat
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  async checkSession() {
    try {
      await this._getCsrfToken();
      const res = await fetch(`${USER_INFO_URL}?app_id=12&_t=${Date.now()}`, {
        headers: {
          ...this._jsonHeaders(),
          'x-csrf-token': this.csrfToken || '',
          'x-request-id': generateRequestId(),
        },
      });
      const body = await res.json().catch(() => null);
      const valid = !!body?.data?.user?.id;
      return {
        valid,
        userId: body?.data?.user?.id,
        userName: body?.data?.user?.name,
        message: valid ? 'Session active' : 'Session expired — re-login required',
      };
    } catch (e) {
      return { valid: false, message: `Session check failed: ${e.message}` };
    }
  }

  // --- Headers ---

  _jsonHeaders() {
    return {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9',
      'cookie': this.cookieStr,
      'origin': 'https://www.feishu.cn',
      'referer': 'https://www.feishu.cn/',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
      'accept': '*/*',
      'accept-language': 'zh-CN,zh;q=0.9',
      'content-type': 'application/x-protobuf',
      'locale': 'zh_CN',
      'cookie': this.cookieStr,
      'origin': 'https://www.feishu.cn',
      'referer': 'https://www.feishu.cn/',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: this._protoHeaders(cmd, cmdVersion),
      body: packetBuf,
    });
    const resBuf = Buffer.from(await res.arrayBuffer());
    return { packet: this._decode('Packet', resBuf), ok: res.ok };
  }

  // --- Send Text Message (cmd=5) ---

  async sendMessage(chatId, text, { rootId, parentId } = {}) {
    const cid1 = generateCid();
    const cid2 = generateCid();
    const textPropBuf = this._encode('TextProperty', { content: text });

    const req = {
      type: MsgType.TEXT,
      chatId,
      cid: cid1,
      isNotified: true,
      version: 1,
      content: {
        richText: {
          elementIds: [cid2],
          innerText: text,
          elements: {
            dictionary: {
              [cid2]: { tag: 1, property: textPropBuf },
            },
          },
        },
      },
    };
    if (rootId) req.rootId = rootId;
    if (parentId) req.parentId = parentId;

    const { packet, ok } = await this._gateway(5, 'PutMessageRequest', req, '5.7.0');
    return {
      success: ok && (packet.status === 0 || packet.status == null),
      status: packet.status,
    };
  }

  // --- Send Image (cmd=5, type=IMAGE) ---

  async sendImage(chatId, imageKey, { rootId, parentId } = {}) {
    const cid1 = generateCid();
    const req = {
      type: MsgType.IMAGE,
      chatId,
      cid: cid1,
      isNotified: true,
      version: 1,
      content: { imageKey },
    };
    if (rootId) req.rootId = rootId;
    if (parentId) req.parentId = parentId;

    const { packet, ok } = await this._gateway(5, 'PutMessageRequest', req, '5.7.0');
    return {
      success: ok && (packet.status === 0 || packet.status == null),
      status: packet.status,
    };
  }

  // --- Send File (cmd=5, type=FILE) ---

  async sendFile(chatId, fileKey, fileName, { rootId, parentId } = {}) {
    const cid1 = generateCid();
    const req = {
      type: MsgType.FILE,
      chatId,
      cid: cid1,
      isNotified: true,
      version: 1,
      content: { fileKey, fileName },
    };
    if (rootId) req.rootId = rootId;
    if (parentId) req.parentId = parentId;

    const { packet, ok } = await this._gateway(5, 'PutMessageRequest', req, '5.7.0');
    return {
      success: ok && (packet.status === 0 || packet.status == null),
      status: packet.status,
    };
  }

  // --- Send Audio (cmd=5, type=AUDIO) ---

  async sendAudio(chatId, audioKey, { rootId, parentId } = {}) {
    const cid1 = generateCid();
    const req = {
      type: MsgType.AUDIO,
      chatId,
      cid: cid1,
      isNotified: true,
      version: 1,
      content: { audioKey },
    };
    if (rootId) req.rootId = rootId;
    if (parentId) req.parentId = parentId;

    const { packet, ok } = await this._gateway(5, 'PutMessageRequest', req, '5.7.0');
    return {
      success: ok && (packet.status === 0 || packet.status == null),
      status: packet.status,
    };
  }

  // --- Send Sticker (cmd=5, type=STICKER) ---

  async sendSticker(chatId, stickerId, stickerSetId, { rootId, parentId } = {}) {
    const cid1 = generateCid();
    const req = {
      type: MsgType.STICKER,
      chatId,
      cid: cid1,
      isNotified: true,
      version: 1,
      content: { stickerId, stickerSetId },
    };
    if (rootId) req.rootId = rootId;
    if (parentId) req.parentId = parentId;

    const { packet, ok } = await this._gateway(5, 'PutMessageRequest', req, '5.7.0');
    return {
      success: ok && (packet.status === 0 || packet.status == null),
      status: packet.status,
    };
  }

  // --- Send Rich Text / POST (cmd=5, type=POST) ---

  async sendPost(chatId, title, paragraphs, { rootId, parentId } = {}) {
    // paragraphs: array of arrays of elements
    // Each element: { tag: 'text', text: '...' } or { tag: 'at', userId: '...' } or { tag: 'a', href: '...', text: '...' }
    // Builds flat richText structure (one element per text segment)
    const cid1 = generateCid();
    const elementIds = [];
    const dictionary = {};

    for (const para of paragraphs) {
      for (const elem of para) {
        const elemId = generateCid();
        elementIds.push(elemId);

        if (elem.tag === 'text') {
          const propBuf = this._encode('TextProperty', { content: elem.text });
          dictionary[elemId] = { tag: 1, property: propBuf };
        } else if (elem.tag === 'at') {
          const propBuf = this._encode('TextProperty', { content: elem.userId });
          dictionary[elemId] = { tag: 5, property: propBuf };
        } else if (elem.tag === 'a') {
          const propBuf = this._encode('TextProperty', { content: elem.text || elem.href });
          dictionary[elemId] = { tag: 6, property: propBuf };
        }
      }
    }

    const innerText = paragraphs.map(p => p.map(e => e.text || '').join('')).join('\n');

    const req = {
      type: MsgType.POST,
      chatId,
      cid: cid1,
      isNotified: true,
      version: 1,
      content: {
        title: title || '',
        richText: {
          elementIds,
          innerText,
          elements: { dictionary },
        },
      },
    };
    if (rootId) req.rootId = rootId;
    if (parentId) req.parentId = parentId;

    const { packet, ok } = await this._gateway(5, 'PutMessageRequest', req, '5.7.0');
    return {
      success: ok && (packet.status === 0 || packet.status == null),
      status: packet.status,
    };
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
    return (searchRes.results || []).map((r) => ({
      id: r.id,
      type: r.type === 1 ? 'user' : r.type === 3 ? 'group' : 'bot',
      title: r.titleHighlighted?.replace(/<[^>]+>/g, '') || '',
      summary: r.summaryHighlighted?.replace(/<[^>]+>/g, '') || '',
    }));
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

  // --- Get User Name (cmd=5023) ---

  async getUserName(userId, chatId) {
    const { packet } = await this._gateway(5023, 'GetUserInfoRequest', {
      userId: parseInt(userId),
      chatId: chatId ? parseInt(chatId) : 0,
      userType: 1,
    });

    if (!packet.payload) return null;
    const userInfo = this._decode('UserInfo', packet.payload);
    const detail = userInfo?.userInfoDetail?.detail;
    if (detail?.locales) {
      const zhEntry = detail.locales.find((l) => l.keyString === 'zh_cn');
      if (zhEntry) return zhEntry.translation;
    }
    if (detail?.nickname) {
      return Buffer.isBuffer(detail.nickname) ? detail.nickname.toString('utf-8') : String(detail.nickname);
    }
    return null;
  }
}

module.exports = { LarkUserClient, MsgType };
