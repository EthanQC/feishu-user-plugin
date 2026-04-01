#!/usr/bin/env node
/**
 * CLI entry point for feishu-user-plugin
 *
 * Usage:
 *   npx feishu-user-plugin          → Start MCP server (default, used by Claude Code)
 *   npx feishu-user-plugin setup    → Interactive setup wizard
 *   npx feishu-user-plugin oauth    → Run OAuth flow for UAT
 *   npx feishu-user-plugin status   → Check auth status
 *   npx feishu-user-plugin keepalive → Refresh cookie + UAT (for cron)
 */

const cmd = process.argv[2];

switch (cmd) {
  case 'setup':
    require('./setup');
    break;
  case 'oauth':
    require('./oauth');
    break;
  case 'status':
    checkStatus();
    break;
  case 'keepalive':
    keepalive();
    break;
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  default:
    // Default: start MCP server (used by Claude Code / MCP clients)
    require('./index');
    break;
}

function printHelp() {
  console.log(`
feishu-user-plugin — All-in-one Feishu MCP Server

Commands:
  (default)   Start MCP server (used by Claude Code)
  setup       Interactive setup wizard — writes MCP config
  oauth       Run OAuth flow to obtain user_access_token
  status      Check authentication status
  keepalive   Refresh cookie + UAT to prevent expiration (for cron jobs)
  help        Show this help

Quick Start (team members):
  1. npx feishu-user-plugin setup
  2. Follow the prompts to configure credentials
  3. Restart Claude Code

Quick Start (external users):
  1. Create a Feishu app at https://open.feishu.cn/app
  2. npx feishu-user-plugin setup
  3. npx feishu-user-plugin oauth
  4. Restart Claude Code

Auto-renewal (optional):
  Add to crontab to keep tokens alive even when Claude Code is closed:
  crontab -e → add: 0 */4 * * * npx feishu-user-plugin keepalive >> /tmp/feishu-keepalive.log 2>&1
`);
}

async function keepalive() {
  const { LarkUserClient } = require('./client');
  const { LarkOfficialClient } = require('./official');
  const { findMcpConfig, persistToConfig } = require('./config');

  const found = findMcpConfig();
  if (!found) {
    console.error('[keepalive] No config found. Run: npx feishu-user-plugin setup');
    process.exit(1);
  }
  const creds = found.serverEnv;
  let ok = true;

  // 1. Refresh Cookie
  const cookie = creds.LARK_COOKIE;
  if (cookie && cookie !== 'SETUP_NEEDED') {
    try {
      const client = new LarkUserClient(cookie);
      await client.init();
      // init() calls _getCsrfToken which refreshes sl_session
      persistToConfig({ LARK_COOKIE: client.cookieStr });
      console.log(`[keepalive] Cookie refreshed (user: ${client.userName})`);
    } catch (e) {
      console.error(`[keepalive] Cookie refresh FAILED: ${e.message}`);
      ok = false;
    }
  }

  // 2. Refresh UAT
  const appId = creds.LARK_APP_ID;
  const appSecret = creds.LARK_APP_SECRET;
  const uat = creds.LARK_USER_ACCESS_TOKEN;
  const rt = creds.LARK_USER_REFRESH_TOKEN;
  if (appId && appSecret && uat && uat !== 'SETUP_NEEDED' && rt) {
    try {
      const official = new LarkOfficialClient(appId, appSecret);
      official._uat = uat;
      official._uatRefresh = rt;
      official._uatExpires = 0; // force refresh
      await official._refreshUAT(); // refreshes + persists automatically
      console.log('[keepalive] UAT refreshed');
    } catch (e) {
      console.error(`[keepalive] UAT refresh FAILED: ${e.message}`);
      ok = false;
    }
  }

  if (ok) {
    console.log('[keepalive] All tokens refreshed successfully');
  }
  process.exit(ok ? 0 : 1);
}

async function checkStatus() {
  const { LarkUserClient } = require('./client');
  const { LarkOfficialClient } = require('./official');
  const { findMcpConfig } = require('./config');

  const found = findMcpConfig();
  const creds = found ? found.serverEnv : {};

  console.log('=== feishu-user-plugin Auth Status ===\n');
  if (found) {
    console.log(`Config: ${found.configPath}${found.projectPath ? ` (project: ${found.projectPath})` : ''}`);
  } else {
    console.log('Config: NOT FOUND (run: npx feishu-user-plugin setup)');
  }
  console.log('');

  // Cookie
  const cookie = creds.LARK_COOKIE;
  if (cookie && cookie !== 'SETUP_NEEDED') {
    try {
      const client = new LarkUserClient(cookie);
      await client.init();
      console.log(`Cookie: OK (user: ${client.userName || client.userId})`);
    } catch (e) {
      console.log(`Cookie: FAILED — ${e.message}`);
    }
  } else {
    console.log('Cookie: NOT SET');
  }

  // App credentials
  const appId = creds.LARK_APP_ID;
  const appSecret = creds.LARK_APP_SECRET;
  console.log(`App credentials: ${appId && appSecret ? 'OK' : 'NOT SET'}`);

  // UAT
  const uat = creds.LARK_USER_ACCESS_TOKEN;
  const rt = creds.LARK_USER_REFRESH_TOKEN;
  if (uat && uat !== 'SETUP_NEEDED') {
    console.log(`UAT: SET (refresh_token: ${rt ? 'YES' : 'NO'})`);
    if (appId && appSecret) {
      const official = new LarkOfficialClient(appId, appSecret);
      // Set UAT fields directly (bypassing loadUAT which reads from process.env)
      official._uat = uat;
      official._uatRefresh = rt || null;
      official._uatExpires = parseInt(creds.LARK_UAT_EXPIRES || '0');
      try {
        await official.listChatsAsUser({ pageSize: 1 });
        console.log('  UAT test: OK (can list chats)');
      } catch (e) {
        console.log(`  UAT test: FAILED — ${e.message}`);
      }
    }
  } else {
    console.log('UAT: NOT SET (run: npx feishu-user-plugin oauth)');
  }
}
