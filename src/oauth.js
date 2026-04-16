#!/usr/bin/env node
/**
 * OAuth 授权脚本 — 获取带 IM 权限的 user_access_token
 *
 * 用法: npx feishu-user-plugin oauth
 *
 * 流程 (新版 End User Consent):
 * 1. 查询应用信息，提示用户选择正确的飞书账号
 * 2. 启动本地 HTTP 服务器 (端口 9997)
 * 3. 打开 accounts.feishu.cn 授权页面 (新版 OAuth 2.0)
 * 4. 用户点击"授权"后，用 /authen/v2/oauth/token 交换 token
 * 5. 保存 token 到 MCP 配置文件
 */

const http = require('http');
const { execSync } = require('child_process');
const { readCredentials, persistToConfig } = require('./config');

const creds = readCredentials();
const APP_ID = creds.LARK_APP_ID;
const APP_SECRET = creds.LARK_APP_SECRET;
const PORT = 9997;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
// offline_access is required to get refresh_token for auto-renewal
// Write scopes (docx:document, drive:drive, bitable:app) allow creating resources as the user, not the app
const SCOPES = 'offline_access auth:user.id:read im:message im:message:readonly im:chat im:chat:readonly contact:user.base:readonly contact:user.id:readonly docx:document drive:drive bitable:app wiki:wiki:readonly';

if (!APP_ID || !APP_SECRET) {
  console.error('Missing LARK_APP_ID or LARK_APP_SECRET.');
  console.error('Run "npx feishu-user-plugin setup" first to configure app credentials.');
  process.exit(1);
}

// --- Fetch app info to help user pick the right account ---

async function getAppInfo() {
  try {
    // Get app_access_token to query app details
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.app_access_token) return null;

    // Get app info — try the direct app query first, fall back to underauditlist
    let appName = null;
    const directRes = await fetch(`https://open.feishu.cn/open-apis/application/v6/applications/${APP_ID}?lang=zh_cn`, {
      headers: { 'Authorization': `Bearer ${tokenData.app_access_token}` },
    });
    const directData = await directRes.json();
    appName = directData?.data?.app?.app_name;

    if (!appName) {
      const listRes = await fetch('https://open.feishu.cn/open-apis/application/v6/applications/underauditlist?lang=zh_cn&page_size=1', {
        headers: { 'Authorization': `Bearer ${tokenData.app_access_token}` },
      });
      const listData = await listRes.json();
      appName = listData?.data?.items?.[0]?.app_name;
    }

    return { appName, tenantKey: tokenData.tenant_key };
  } catch {
    return null;
  }
}

async function exchangeCode(code) {
  const body = {
    grant_type: 'authorization_code',
    client_id: APP_ID,
    client_secret: APP_SECRET,
    code,
    redirect_uri: REDIRECT_URI,
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
  const updates = {
    LARK_USER_ACCESS_TOKEN: tokenData.access_token,
    LARK_USER_REFRESH_TOKEN: tokenData.refresh_token || '',
    LARK_UAT_SCOPE: tokenData.scope || '',
    LARK_UAT_EXPIRES: String(Math.floor(Date.now() / 1000 + (typeof tokenData.expires_in === 'number' && tokenData.expires_in > 0 ? tokenData.expires_in : 7200))),
  };

  const ok = persistToConfig(updates);
  if (!ok) {
    console.error('WARNING: Tokens could not be saved to config. Copy them manually:');
    for (const [k, v] of Object.entries(updates)) {
      console.error(`  ${k}=${v}`);
    }
  }
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

      const hasRefresh = !!tokenData.refresh_token;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<h2>✅ 授权成功!</h2>
<p>access_token: ${tokenData.access_token.slice(0, 20)}...</p>
<p>scope: ${tokenData.scope}</p>
<p>expires_in: ${tokenData.expires_in}s</p>
<p>refresh_token: ${hasRefresh ? '✅ 已获取（30天有效，支持自动续期）' : '❌ 未返回（token 将在 2 小时后过期，需重新授权）'}</p>
<p>已保存到 MCP 配置文件，可以关闭此页面。</p>`);

      console.log('\n=== OAuth 授权成功 ===');
      console.log('scope:', tokenData.scope);
      console.log('expires_in:', tokenData.expires_in, 's');
      console.log('refresh_token:', hasRefresh ? '✅ 已获取' : '❌ 未返回');
      if (!hasRefresh) {
        console.log('\n⚠️  未获取到 refresh_token。可能原因：');
        console.log('   - 飞书应用未启用 offline_access 权限');
        console.log('   - 授权时 scope 中未包含 offline_access');
        console.log('   Token 将在 2 小时后过期，届时需要重新运行此脚本。');
      }
      console.log('token 已保存到 MCP 配置文件');

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

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Another OAuth process may be running.`);
    console.error('Wait a minute and try again, or kill the process using the port.');
  } else {
    console.error('Server error:', e.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', async () => {
  const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}`;

  console.log('='.repeat(60));
  console.log('  飞书 OAuth 授权');
  console.log('='.repeat(60));
  console.log(`  应用 ID: ${APP_ID}`);

  // Try to get app info for better guidance
  const appInfo = await getAppInfo();
  if (appInfo?.appName) {
    console.log(`  应用名称: ${appInfo.appName}`);
  }

  console.log('');
  console.log('  ⚠️  重要：请在浏览器中选择正确的飞书账号！');
  console.log('  如果你有多个飞书账号（个人/公司），请确保选择');
  console.log(`  与应用 ${APP_ID} 同一租户的账号。`);
  console.log('');
  console.log('  如果浏览器显示了错误的账号，请：');
  console.log('  1. 先在 feishu.cn 切换到正确的租户/账号');
  console.log('  2. 然后重新运行此脚本');
  console.log('='.repeat(60));
  console.log('');
  console.log('OAuth 服务器已启动，端口:', PORT);
  console.log('正在打开浏览器...');
  console.log('授权 URL:', authUrl);

  try {
    const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    execSync(`${openCmd} "${authUrl}"`);
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
