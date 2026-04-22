// Unified Feishu ID resolver — accepts three input forms and produces
// a concrete { obj_type, obj_token } pair that downstream docx / bitable
// tools can consume.
//
// Accepted inputs:
//   • Native token               (e.g. "doccnXXX", "bascnXXX", "docxAAA")
//   • Wiki node token            (e.g. "wikcnAAA", "wikmXXX", "wikxxxXXX")
//   • Full Feishu URL            (e.g. "https://xxx.feishu.cn/docx/DocXXX?...")
//
// Exposed functions:
//   parseFeishuInput(input)       — pure, no I/O. Maps input → { kind, token, raw }.
//   resolveToObj(input, official) — async. For wiki kind, calls official.getWikiNode
//                                   to unwrap to the underlying obj_token + obj_type.
//                                   Results cached for 10 min.

// Host allows the `<sub>.feishu.cn` / `<sub>.larksuite.com` pattern with an
// optional port (some corporate proxies surface :443 explicitly; rare but we
// cost nothing by allowing it).
const URL_RE = /^https?:\/\/[^/]*(feishu\.cn|larksuite\.com)(?::\d+)?\/(docx|wiki|base|sheets|file|docs)\/([A-Za-z0-9_-]+)/;
const WIKI_BARE_RE = /^(wik[a-z]{1,4})([A-Za-z0-9_-]{6,})$/; // wikcn / wikm / wikn / wiki prefixes

// Feishu URL segment → obj_type mapping. 'docs' is the legacy doc type (pre-docx).
const URL_KIND_MAP = {
  docx: 'docx',
  docs: 'doc',
  wiki: 'wiki',
  base: 'bitable',
  sheets: 'sheet',
  file:  'file',
};

/**
 * Parse a Feishu input string into its components. Pure / no I/O.
 * @param {string} input
 * @returns {{kind: string, token: string, raw: string}}
 *   kind: 'docx' | 'doc' | 'wiki' | 'bitable' | 'sheet' | 'file' | 'raw'
 *   token: the extracted token (or the original string if kind='raw')
 *   raw: the original input (for diagnostics)
 */
function parseFeishuInput(input) {
  if (input === null || input === undefined) {
    throw new Error('parseFeishuInput: input is required');
  }
  const s = String(input).trim();
  if (!s) throw new Error('parseFeishuInput: input is empty');

  // URL form
  const m = s.match(URL_RE);
  if (m) {
    const segment = m[2];
    const token = m[3];
    const kind = URL_KIND_MAP[segment] || 'raw';
    return { kind, token, raw: s };
  }

  // Bare wiki node token (starts with wik-prefix like wikcn/wikm/wikn and has body)
  if (WIKI_BARE_RE.test(s)) {
    return { kind: 'wiki', token: s, raw: s };
  }

  // Everything else is a raw native token — downstream will trust it as-is.
  return { kind: 'raw', token: s, raw: s };
}

// --- LRU cache for wiki-node → obj resolution ---
// Wiki node tokens are long-lived; the obj_token and obj_type behind them
// essentially never change, so a 10-minute TTL prevents refetching the
// same node 20 times in one chain of tool calls but still lets the rare
// re-parented-node case catch up on its own.

const CACHE_MAX = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;
const _cache = new Map(); // token → { value, expiresAt }

function _cacheGet(token) {
  const e = _cache.get(token);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    _cache.delete(token);
    return null;
  }
  // Refresh LRU position
  _cache.delete(token);
  _cache.set(token, e);
  return e.value;
}

function _cacheSet(token, value) {
  if (_cache.has(token)) _cache.delete(token);
  _cache.set(token, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  // Evict oldest if over cap
  while (_cache.size > CACHE_MAX) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
}

/**
 * Resolve a user-provided input into a concrete { obj_type, obj_token, space_id? }.
 * @param {string} input
 * @param {object} official LarkOfficialClient instance (for wiki getNode lookup)
 * @returns {Promise<{obj_type: string, obj_token: string, space_id?: string, via: string}>}
 *   via: 'url-direct' | 'wiki-lookup' | 'raw-passthrough'
 */
async function resolveToObj(input, official) {
  const parsed = parseFeishuInput(input);

  // Wiki node — must call getWikiNode to unwrap.
  if (parsed.kind === 'wiki') {
    const cached = _cacheGet(parsed.token);
    if (cached) return { ...cached, via: 'wiki-lookup-cached' };
    if (!official || typeof official.getWikiNode !== 'function') {
      throw new Error('resolveToObj: wiki input requires an official client, none provided');
    }
    const node = await official.getWikiNode(parsed.token);
    if (!node || !node.obj_token || !node.obj_type) {
      throw new Error(`resolveToObj: wiki node ${parsed.token} missing obj_token/obj_type in response: ${JSON.stringify(node)}`);
    }
    const value = {
      obj_type: node.obj_type,   // e.g. 'docx' | 'sheet' | 'bitable' | 'mindnote' | 'slide' | 'file'
      obj_token: node.obj_token,
      space_id: node.space_id,
    };
    _cacheSet(parsed.token, value);
    return { ...value, via: 'wiki-lookup' };
  }

  // Native URL with a direct doc/bitable/etc segment — just use the extracted token.
  if (parsed.kind !== 'raw') {
    return { obj_type: parsed.kind, obj_token: parsed.token, via: 'url-direct' };
  }

  // Raw — caller knows what they're doing, pass through without claiming a type.
  return { obj_type: 'raw', obj_token: parsed.token, via: 'raw-passthrough' };
}

/**
 * Convenience shortcut: resolve and return just the obj_token.
 * Used in handler prologues where we only need the native token and trust the tool
 * to know which surface it's hitting.
 */
async function resolveToken(input, official) {
  const r = await resolveToObj(input, official);
  return r.obj_token;
}

module.exports = {
  parseFeishuInput,
  resolveToObj,
  resolveToken,
};
