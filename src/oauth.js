#!/usr/bin/env node
/**
 * OAuth 授权脚本 — 获取带 IM 权限的 user_access_token
 *
 * 用法: node src/oauth.js
 *
 * 流程 (新版 End User Consent):
 * 1. 启动本地 HTTP 服务器 (端口 9997)
 * 2. 打开 accounts.feishu.cn 授权页面 (新版 OAuth 2.0)
 * 3. 用户点击"授权"后，用 /authen/v2/oauth/token 交换 token
 * 4. 保存到 .env 文件中的 LARK_USER_ACCESS_TOKEN
 */

const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const APP_ID = process.env.LARK_APP_ID;
const APP_SECRET = process.env.LARK_APP_SECRET;
const PORT = 9997;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'im:message im:message:readonly im:chat:readonly contact:user.base:readonly';

if (!APP_ID || !APP_SECRET) {
  console.error('Missing LARK_APP_ID or LARK_APP_SECRET in .env');
  process.exit(1);
}

async function exchangeCode(code) {
  // Exchange code for user_access_token (new OAuth 2.0 v2 flow)
  const body = {
    grant_type: 'authorization_code',
    client_id: APP_ID,
    client_secret: APP_SECRET,
    code,
  };
  console.log('Token exchange request:', JSON.stringify({ ...body, client_secret: '***' }));
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await tokenRes.text();
  console.log('Token exchange raw response:', raw.slice(0, 500));
  let tokenData;
  try { tokenData = JSON.parse(raw); } catch (e) {
    throw new Error(`Response not JSON: ${raw.slice(0, 200)}`);
  }
  if (tokenData.error) {
    throw new Error(`${tokenData.error}: ${tokenData.error_description}`);
  }
  if (tokenData.code && tokenData.code !== 0) {
    throw new Error(`Error ${tokenData.code}: ${tokenData.msg || JSON.stringify(tokenData)}`);
  }
  // v2 success: access_token at top level
  if (tokenData.access_token) return tokenData;
  if (tokenData.data?.access_token) return tokenData.data;
  throw new Error(`No access_token in response: ${JSON.stringify(tokenData)}`);
}

function saveToken(tokenData) {
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf8'); } catch {}

  const updates = {
    LARK_USER_ACCESS_TOKEN: tokenData.access_token,
    LARK_USER_REFRESH_TOKEN: tokenData.refresh_token,
    LARK_UAT_SCOPE: tokenData.scope || '',
    LARK_UAT_EXPIRES: String(Math.floor(Date.now() / 1000 + tokenData.expires_in)),
  };

  for (const [key, val] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${val}`);
    } else {
      envContent += `\n${key}=${val}`;
    }
  }

  fs.writeFileSync(envPath, envContent.trim() + '\n');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h2>授权失败：未收到 code</h2>');
      return;
    }

    try {
      const tokenData = await exchangeCode(code);
      saveToken(tokenData);

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<h2>授权成功!</h2>
<p>access_token: ${tokenData.access_token.slice(0, 20)}...</p>
<p>scope: ${tokenData.scope}</p>
<p>expires_in: ${tokenData.expires_in}s</p>
<p>已保存到 .env，可以关闭此页面。</p>`);

      console.log('\n=== OAuth 授权成功 ===');
      console.log('scope:', tokenData.scope);
      console.log('expires_in:', tokenData.expires_in, 's');
      console.log('token 已保存到 .env');

      setTimeout(() => { server.close(); process.exit(0); }, 1000);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<h2>Token 交换失败</h2><p>${e.message}</p>`);
      console.error('Token exchange error:', e.message);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  // New End User Consent authorize URL (accounts.feishu.cn, client_id, response_type=code)
  const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}`;

  console.log('OAuth 服务器已启动，端口:', PORT);
  console.log('正在打开浏览器进行授权...');
  console.log('授权 URL:', authUrl);

  try {
    execSync(`open "${authUrl}"`);
  } catch {
    console.log('\n请手动在浏览器中打开上面的 URL');
  }

  console.log('\n等待授权回调... (120 秒超时)');
  setTimeout(() => {
    console.error('\n超时，未收到授权回调。');
    server.close();
    process.exit(1);
  }, 120000);
});
