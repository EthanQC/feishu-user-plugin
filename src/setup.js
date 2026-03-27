#!/usr/bin/env node
/**
 * Interactive setup wizard for feishu-user-plugin
 *
 * Writes MCP config to ~/.claude.json (or .mcp.json) with credentials.
 * Does NOT require cloning the repo.
 */

const readline = require('readline');
const { findMcpConfig, writeNewConfig } = require('./config');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('='.repeat(60));
  console.log('  feishu-user-plugin Setup Wizard');
  console.log('='.repeat(60));
  console.log('');

  // Check existing config
  let existingEnv = {};
  const found = findMcpConfig();
  if (found) {
    existingEnv = found.serverEnv;
    console.log(`Found existing config in ${found.configPath}`);
    const update = await ask('Update existing config? (Y/n): ');
    if (update.toLowerCase() === 'n') {
      console.log('Cancelled.');
      rl.close();
      return;
    }
  }

  // Collect credentials
  console.log('\n--- App Credentials ---');
  console.log('Team members: press Enter to use the shared defaults.');
  console.log('External users: get these from https://open.feishu.cn/app\n');

  const defaultAppId = existingEnv.LARK_APP_ID || '';
  const defaultAppSecret = existingEnv.LARK_APP_SECRET || '';

  let appId = await ask(`LARK_APP_ID [${defaultAppId || 'required'}]: `);
  appId = appId.trim() || defaultAppId;
  if (!appId) {
    console.error('Error: LARK_APP_ID is required.');
    rl.close();
    process.exit(1);
  }

  let appSecret = await ask(`LARK_APP_SECRET [${defaultAppSecret ? '***' : 'required'}]: `);
  appSecret = appSecret.trim() || defaultAppSecret;
  if (!appSecret) {
    console.error('Error: LARK_APP_SECRET is required.');
    rl.close();
    process.exit(1);
  }

  // Validate app credentials
  console.log('\nValidating app credentials...');
  try {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await res.json();
    if (data.app_access_token) {
      console.log('App credentials: VALID');
    } else {
      console.error(`App credentials: INVALID — ${data.msg || JSON.stringify(data)}`);
      console.error('Please check your LARK_APP_ID and LARK_APP_SECRET.');
      rl.close();
      process.exit(1);
    }
  } catch (e) {
    console.warn(`Could not validate: ${e.message}. Continuing anyway.`);
  }

  // Cookie
  console.log('\n--- Cookie ---');
  console.log('Get your cookie from feishu.cn (Network tab → first request → Cookie header).');
  console.log('Or let Claude Code + Playwright extract it automatically after setup.\n');

  const existingCookie = existingEnv.LARK_COOKIE;
  const hasCookie = existingCookie && existingCookie !== 'PLACEHOLDER' && existingCookie.includes('session=');
  if (hasCookie) {
    console.log('Existing cookie found (has session token).');
    const keepCookie = await ask('Keep existing cookie? (Y/n): ');
    if (keepCookie.toLowerCase() === 'n') {
      console.log('You can update it later or use Playwright extraction.');
    }
  } else {
    console.log('No valid cookie found. You can add it later via:');
    console.log('  1. Tell Claude Code: "帮我设置飞书 Cookie" (with Playwright MCP)');
    console.log('  2. Manual: DevTools → Network → Cookie header → paste into config');
  }

  const cookie = hasCookie ? existingCookie : 'SETUP_NEEDED';

  // UAT
  const existingUAT = existingEnv.LARK_USER_ACCESS_TOKEN;
  const existingRT = existingEnv.LARK_USER_REFRESH_TOKEN;
  const hasUAT = existingUAT && existingUAT !== 'PLACEHOLDER' && existingUAT.length > 20;

  if (!hasUAT) {
    console.log('\n--- OAuth UAT ---');
    console.log('UAT not configured. After setup, run:');
    console.log('  npx feishu-user-plugin oauth');
    console.log('This will open a browser for OAuth consent.');
  }

  // Write config
  console.log('\n--- Writing Config ---');

  const env = {
    LARK_COOKIE: cookie,
    LARK_APP_ID: appId,
    LARK_APP_SECRET: appSecret,
    LARK_USER_ACCESS_TOKEN: hasUAT ? existingUAT : 'SETUP_NEEDED',
    LARK_USER_REFRESH_TOKEN: hasUAT ? (existingRT || '') : '',
  };

  // If we found an existing config, write to the same file (preserving project-level nesting)
  const targetPath = found ? found.configPath : undefined;
  const projPath = found ? found.projectPath : undefined;
  const result = writeNewConfig(env, targetPath, projPath);
  console.log(`Written to ${result.configPath}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  Setup Complete!');
  console.log('='.repeat(60));
  console.log('');

  const todo = [];
  if (cookie === 'SETUP_NEEDED') todo.push('Get Cookie: tell Claude Code "帮我设置飞书 Cookie"');
  if (!hasUAT) todo.push('Get UAT: run "npx feishu-user-plugin oauth"');
  todo.push('Restart Claude Code');

  console.log('Next steps:');
  todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  console.log('');

  rl.close();
}

main().catch(e => {
  console.error('Setup failed:', e.message);
  rl.close();
  process.exit(1);
});
