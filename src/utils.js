// Random 10-char alphanumeric string
function generateRequestId() {
  return (Math.random().toString(36) + '0000000000').substring(2, 12);
}

// Random 10-char CID from alphanumeric set
function generateCid() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars[(Math.random() * chars.length) | 0];
  }
  return result;
}

// Parse cookie string to object
function parseCookie(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = rest.join('=');
  });
  return cookies;
}

// Format cookie object to string for headers
function formatCookie(cookieObj) {
  return Object.entries(cookieObj)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// Wraps global fetch with an AbortController-based timeout. A stalled network
// connection to feishu.cn can otherwise block an MCP tool handler indefinitely,
// causing the client to time out and (in some clients) tear down the stdio
// transport — observed as "MCP 中途掉线" by v1.3.2 users.
// Default 30s; pass `timeoutMs` in init to override per-call.
function fetchWithTimeout(url, init = {}) {
  const { timeoutMs = 30000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`fetch timeout after ${timeoutMs}ms: ${url}`)), timeoutMs);
  return fetch(url, { ...rest, signal: rest.signal || controller.signal }).finally(() => clearTimeout(timer));
}

module.exports = {
  generateRequestId,
  generateCid,
  parseCookie,
  formatCookie,
  fetchWithTimeout,
};
