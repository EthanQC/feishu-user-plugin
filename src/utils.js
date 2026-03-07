const crypto = require('crypto');

// MD5 hash — replaces the obfuscated lark_decrypt.js
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// Generate access_key for WebSocket connection
function generateAccessKey(input) {
  return md5(input);
}

// Random 10-char alphanumeric string
function generateRequestId() {
  return (Math.random().toString(36) + '0000000000').substring(2, 12);
}

// UUID v4 format
function generateLongRequestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
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
  md5,
  generateAccessKey,
  generateRequestId,
  generateLongRequestId,
  generateCid,
  parseCookie,
  formatCookie,
};
