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

module.exports = {
  generateRequestId,
  generateCid,
  parseCookie,
  formatCookie,
};
