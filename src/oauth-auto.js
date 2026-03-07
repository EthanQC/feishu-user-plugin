#!/usr/bin/env node
// Automated OAuth flow using Playwright — single page, no extra tabs
const http = require('http');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const APP_ID = process.env.LARK_APP_ID;
const APP_SECRET = process.env.LARK_APP_SECRET;
const COOKIE_STR = process.env.LARK_COOKIE;
const PORT = 9997;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'im:message im:message:readonly im:chat:readonly contact:user.base:readonly';

function parseCookies(cookieStr) {
  return cookieStr.split(';').map(c => {
    const [name, ...rest] = c.trim().split('=');
    return { name: name.trim(), value: rest.join('=').trim(), domain: '.feishu.cn', path: '/' };
  }).filter(c => c.name && c.value);
}

function saveToken(tokenData) {
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf8'); } catch {}
  const updates = {
    LARK_USER_ACCESS_TOKEN: tokenData.access_token,
    LARK_USER_REFRESH_TOKEN: tokenData.refresh_token || '',
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

async function exchangeCode(code) {
  console.log('[token] Exchanging code via v2...');
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: APP_ID, client_secret: APP_SECRET, code, redirect_uri: REDIRECT_URI }),
  });
  const raw = await res.text();
  console.log('[token] Response:', raw.slice(0, 300));
  const data = JSON.parse(raw);
  if (data.access_token) return data;
  if (data.data?.access_token) return data.data;
  throw new Error(`Token exchange failed: ${raw.slice(0, 200)}`);
}

async function run() {
  // Start callback server to capture the code
  let resolveCode;
  const codePromise = new Promise(resolve => { resolveCode = resolve; });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(code ? '<h2>OK</h2>' : '<h2>No code</h2>');
      if (code) resolveCode(code);
    } else {
      res.writeHead(404); res.end();
    }
  });
  server.listen(PORT, '127.0.0.1');
  console.log(`[server] Listening on port ${PORT}`);

  // Launch browser — use the first page directly (no extra about:blank)
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await context.addCookies(parseCookies(COOKIE_STR));

  // Listen for any new page (popup) that might open
  context.on('page', async newPage => {
    const url = newPage.url();
    console.log('[context] New page opened:', url.slice(0, 200));
  });

  // Get the default page instead of creating a new one
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    const authUrl = `https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}`;
    console.log('\n[auth] Opening authorize URL...');

    // Use route interception to capture the callback redirect directly
    let codeFromRoute = null;
    await context.route('**/callback**', async route => {
      const url = route.request().url();
      console.log('[route] Intercepted callback:', url.slice(0, 200));
      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      if (code) {
        codeFromRoute = code;
        resolveCode(code);
      }
      await route.continue();
    });

    await page.goto(authUrl, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    console.log('[auth] Current URL:', currentUrl.slice(0, 200));

    if (currentUrl.includes('callback?code=')) {
      console.log('[auth] Auto-authorized!');
    } else {
      // Find and click authorize button
      const authorizeBtn = page.locator('button:has-text("授权")').first();
      if (await authorizeBtn.isVisible().catch(() => false)) {
        console.log('[auth] Found 授权 button, clicking...');
        await authorizeBtn.click();
        console.log('[auth] Clicked, waiting for redirect...');
        await page.waitForTimeout(5000);
        console.log('[auth] After click URL:', page.url().slice(0, 200));

        // Check all pages in context
        const allPages = context.pages();
        console.log(`[auth] Total pages: ${allPages.length}`);
        for (let i = 0; i < allPages.length; i++) {
          const pUrl = allPages[i].url();
          console.log(`  [${i}] ${pUrl.slice(0, 200)}`);
          if (pUrl.includes('callback?code=')) {
            const parsed = new URL(pUrl);
            resolveCode(parsed.searchParams.get('code'));
          }
        }
      } else {
        console.log('[auth] No authorize button found!');
        await page.screenshot({ path: '/tmp/feishu-oauth-nobutton.png' });
      }
    }

    // Wait for the code
    console.log('\n[token] Waiting for code...');
    const code = await Promise.race([
      codePromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout (30s)')), 30000)),
    ]);
    console.log('[token] Got code:', code.slice(0, 20) + '...');

    const tokenData = await exchangeCode(code);
    saveToken(tokenData);
    console.log('\n=== SUCCESS ===');
    console.log('access_token:', tokenData.access_token?.slice(0, 30) + '...');
    console.log('scope:', tokenData.scope);
    console.log('expires_in:', tokenData.expires_in, 's');

    // Test P2P message reading
    console.log('\n[test] Testing P2P message reading...');
    const testRes = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=oc_97a52756ee2c4351a2a86e6aa33e8ca4&page_size=2&sort_type=ByCreateTimeDesc', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const testData = await testRes.json();
    if (testData.code === 0) {
      console.log('[test] P2P: SUCCESS!', testData.data?.items?.length, 'messages');
    } else {
      console.log('[test] P2P: Error', testData.code, testData.msg);
    }

    // Test group messages
    const grpRes = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=oc_6ae081b457d07e9651d615493b7f1096&page_size=2&sort_type=ByCreateTimeDesc', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const grpData = await grpRes.json();
    if (grpData.code === 0) {
      console.log('[test] Group: SUCCESS!', grpData.data?.items?.length, 'messages');
    } else {
      console.log('[test] Group: Error', grpData.code, grpData.msg);
    }

  } catch (e) {
    console.error('\nError:', e.message);
    await page.screenshot({ path: '/tmp/feishu-oauth-error.png' }).catch(() => {});
  } finally {
    await browser.close();
    server.close();
  }
}

run();
