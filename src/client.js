const path = require('path');
const protobuf = require('protobufjs');
const { generateRequestId, generateCid, parseCookie, formatCookie } = require('./utils');

const GATEWAY_URL = 'https://internal-api-lark-api.feishu.cn/im/gateway/';
const CSRF_URL = 'https://internal-api-lark-api.feishu.cn/accounts/csrf';
const USER_INFO_URL = 'https://internal-api-lark-api.feishu.cn/accounts/web/user';

class LarkUserClient {
  constructor(cookieStr) {
    this.cookieObj = parseCookie(cookieStr);
    this.cookieStr = cookieStr;
    this.csrfToken = null;
    this.userId = null;
    this.proto = null;
  }

  async init() {
    this.proto = await protobuf.load(path.join(__dirname, '..', 'proto', 'lark.proto'));
    await this._getCsrfToken();
    await this._getUserInfo();
    console.error(`[feishu-user-mcp] Initialized as user: ${this.userId}`);
  }

  // --- Auth ---

  async _getCsrfToken() {
    const res = await fetch(`${CSRF_URL}?_t=${Date.now()}`, {
      method: 'POST',
      headers: {
        ...this._jsonHeaders(),
        'x-request-id': generateRequestId(),
      },
      credentials: 'include',
    });
    // Extract swp_csrf_token from Set-Cookie header
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
    if (!this.csrfToken) {
      // Try from response body
      const body = await res.json().catch(() => ({}));
      console.error('[feishu-user-mcp] CSRF response:', JSON.stringify(body).slice(0, 200));
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
    const body = await res.json();
    if (body?.data?.user?.id) {
      this.userId = String(body.data.user.id);
    } else {
      console.error('[feishu-user-mcp] Failed to get user info:', JSON.stringify(body).slice(0, 300));
    }
  }

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
    const msg = Type.create(data);
    return Type.encode(msg).finish();
  }

  _decode(typeName, buffer) {
    const Type = this.proto.lookupType(typeName);
    return Type.decode(buffer);
  }

  // --- Send Message (as user!) ---

  async sendMessage(chatId, text) {
    const cid1 = generateCid();
    const cid2 = generateCid();

    // Build TextProperty
    const textPropBuf = this._encode('TextProperty', { content: text });

    // Build PutMessageRequest
    const putMsgData = {
      type: 4, // TEXT
      chatId: chatId,
      cid: cid1,
      isNotified: true,
      version: 1,
      content: {
        richText: {
          elementIds: [cid2],
          innerText: text,
          elements: {
            dictionary: {
              [cid2]: {
                tag: 1, // TEXT
                property: textPropBuf,
              },
            },
          },
        },
      },
    };
    const putMsgBuf = this._encode('PutMessageRequest', putMsgData);

    // Wrap in Packet
    const packetBuf = this._encode('Packet', {
      payloadType: 1, // PB2
      cmd: 5,
      cid: generateRequestId(),
      payload: putMsgBuf,
    });

    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: this._protoHeaders(5, '5.7.0'),
      body: packetBuf,
    });

    const resBuf = Buffer.from(await res.arrayBuffer());
    const resPacket = this._decode('Packet', resBuf);
    // cmd=1 in response means message push-back (success), status field may be absent
    return {
      success: res.ok && (resPacket.status === 0 || resPacket.status == null),
      status: resPacket.status,
      cmd: resPacket.cmd,
    };
  }

  // --- Search Contacts ---

  async search(query) {
    const sessionId = generateCid();

    const searchReq = {
      header: {
        searchSession: sessionId,
        sessionSeqId: 1,
        query: query,
        locale: 'zh_CN',
        searchContext: {
          tagName: 'SMART_SEARCH',
          entityItems: [
            { type: 1 }, // USER
            { type: 2 }, // BOT
            { type: 3, filter: { groupChatFilter: {} } }, // GROUP_CHAT
          ],
          commonFilter: { includeOuterTenant: true },
          sourceKey: 'messenger',
        },
      },
    };

    const searchBuf = this._encode('UniversalSearchRequest', searchReq);
    const packetBuf = this._encode('Packet', {
      payloadType: 1,
      cmd: 11021,
      cid: generateRequestId(),
      payload: searchBuf,
    });

    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: this._protoHeaders(11021),
      body: packetBuf,
    });

    const resBuf = Buffer.from(await res.arrayBuffer());
    const resPacket = this._decode('Packet', resBuf);

    if (resPacket.payload) {
      const searchRes = this._decode('UniversalSearchResponse', resPacket.payload);
      return (searchRes.results || []).map((r) => ({
        id: r.id,
        type: r.type === 1 ? 'user' : r.type === 3 ? 'group' : 'other',
        title: r.titleHighlighted?.replace(/<[^>]+>/g, '') || '',
      }));
    }
    return [];
  }

  // --- Create Chat (for P2P) ---

  async createChat(userId) {
    const chatReq = { type: 1, chatterIds: [userId] };
    const chatBuf = this._encode('PutChatRequest', chatReq);
    const packetBuf = this._encode('Packet', {
      payloadType: 1,
      cmd: 13,
      cid: generateRequestId(),
      payload: chatBuf,
    });

    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: this._protoHeaders(13),
      body: packetBuf,
    });

    const resBuf = Buffer.from(await res.arrayBuffer());
    const resPacket = this._decode('Packet', resBuf);

    if (resPacket.payload) {
      const chatRes = this._decode('PutChatResponse', resPacket.payload);
      return chatRes.chat?.id || null;
    }
    return null;
  }

  // --- Get User Name ---

  async getUserName(userId, chatId) {
    const reqBuf = this._encode('GetUserInfoRequest', {
      userId: parseInt(userId),
      chatId: parseInt(chatId),
      userType: 1,
    });
    const packetBuf = this._encode('Packet', {
      payloadType: 1,
      cmd: 5023,
      cid: generateRequestId(),
      payload: reqBuf,
    });

    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: this._protoHeaders(5023),
      body: packetBuf,
    });

    const resBuf = Buffer.from(await res.arrayBuffer());
    const resPacket = this._decode('Packet', resBuf);

    if (resPacket.payload) {
      const userInfo = this._decode('UserInfo', resPacket.payload);
      const detail = userInfo?.userInfoDetail?.detail;
      if (detail?.locales) {
        const zhEntry = detail.locales.find((l) => l.keyString === 'zh_cn');
        if (zhEntry) return zhEntry.translation;
      }
      if (detail?.nickname) {
        return Buffer.isBuffer(detail.nickname) ? detail.nickname.toString('utf-8') : String(detail.nickname);
      }
    }
    return null;
  }
}

module.exports = { LarkUserClient };
