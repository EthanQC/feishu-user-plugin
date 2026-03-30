#!/usr/bin/env node
/**
 * Setup wizard for feishu-user-plugin
 *
 * Two modes:
 *   Interactive:     npx feishu-user-plugin setup
 *   Non-interactive: npx feishu-user-plugin setup --app-id xxx --app-secret yyy
 *
 * Writes MCP config to ~/.claude.json top-level mcpServers (global).
 */

const readline = require('readline');
const { findMcpConfig, writeNewConfig } = require('./config');

// Parse CLI args: --app-id, --app-secret, --cookie
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app-id' && argv[i + 1]) args.appId = argv[++i];
    else if (argv[i] === '--app-secret' && argv[i + 1]) args.appSecret = argv[++i];
    else if (argv[i] === '--cookie' && argv[i + 1]) args.cookie = argv[++i];
  }
  return args;
}

async function main() {
  const cliArgs = parseArgs();
  const nonInteractive = !!(cliArgs.appId && cliArgs.appSecret);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('='.repeat(60));
  console.log('  feishu-user-plugin Setup');
  console.log('='.repeat(60));

  // Check existing config
  let existingEnv = {};
  const found = findMcpConfig();
  if (found) {
    existingEnv = found.serverEnv;
    if (found.projectPath) {
      console.log(`\nFound project-level config in ${found.configPath} (project: ${found.projectPath})`);
      console.log('This setup will write to global config instead (recommended).');
      console.log('You can remove the project-level entry later to avoid conflicts.');
    } else {
      console.log(`\nFound existing config in ${found.configPath}`);
    }
    if (!nonInteractive) {
      const update = await ask('Update config? (Y/n): ');
      if (update.toLowerCase() === 'n') {
        console.log('Cancelled.');
        rl.close();
        return;
      }
    }
  }

  // Resolve App credentials
  let appId, appSecret;

  if (nonInteractive) {
    // CLI args provided — no prompting
    appId = cliArgs.appId;
    appSecret = cliArgs.appSecret;
    console.log(`\nApp ID: ${appId}`);
    console.log('App Secret: ***');
  } else {
    // Interactive mode
    console.log('\n--- App Credentials ---');
    console.log('Get these from https://open.feishu.cn/app\n');

    const defaultAppId = existingEnv.LARK_APP_ID || '';
    const defaultAppSecret = existingEnv.LARK_APP_SECRET || '';

    appId = (await ask(`LARK_APP_ID [${defaultAppId || 'required'}]: `)).trim() || defaultAppId;
    if (!appId) {
      console.error('Error: LARK_APP_ID is required.');
      rl.close();
      process.exit(1);
    }

    appSecret = (await ask(`LARK_APP_SECRET [${defaultAppSecret ? '***' : 'required'}]: `)).trim() || defaultAppSecret;
    if (!appSecret) {
      console.error('Error: LARK_APP_SECRET is required.');
      rl.close();
      process.exit(1);
    }
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
      rl.close();
      process.exit(1);
    }
  } catch (e) {
    console.warn(`Could not validate: ${e.message}. Continuing anyway.`);
  }

  // Resolve Cookie
  let cookie;
  if (cliArgs.cookie) {
    cookie = cliArgs.cookie;
  } else {
    const existingCookie = existingEnv.LARK_COOKIE;
    const hasCookie = existingCookie && existingCookie !== 'SETUP_NEEDED' && existingCookie.includes('session=');
    if (hasCookie) {
      cookie = existingCookie;
      console.log('\nKeeping existing cookie (has session token).');
    } else {
      cookie = 'SETUP_NEEDED';
      if (!nonInteractive) {
        console.log('\n--- Cookie ---');
        console.log('No valid cookie found. After setup:');
        console.log('  Tell Claude Code: "帮我设置飞书 Cookie" (with Playwright MCP)');
        console.log('  Or manually copy from DevTools → Network → Cookie header');
      }
    }
  }

  // Resolve UAT
  const existingUAT = existingEnv.LARK_USER_ACCESS_TOKEN;
  const existingRT = existingEnv.LARK_USER_REFRESH_TOKEN;
  const hasUAT = existingUAT && existingUAT !== 'SETUP_NEEDED' && existingUAT.length > 20;

  // Write config
  console.log('\n--- Writing Config ---');

  const env = {
    LARK_COOKIE: cookie,
    LARK_APP_ID: appId,
    LARK_APP_SECRET: appSecret,
    LARK_USER_ACCESS_TOKEN: hasUAT ? existingUAT : 'SETUP_NEEDED',
    LARK_USER_REFRESH_TOKEN: hasUAT ? (existingRT || '') : '',
  };

  const result = writeNewConfig(env);
  console.log(`Written to ${result.configPath} (global)`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  Setup Complete!');
  console.log('='.repeat(60));

  const todo = [];
  if (cookie === 'SETUP_NEEDED') todo.push('Get Cookie: tell Claude Code "帮我设置飞书 Cookie"');
  if (!hasUAT) todo.push('Get UAT: run "npx feishu-user-plugin oauth"');
  todo.push('Restart Claude Code');

  console.log('\nNext steps:');
  todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  console.log('');

  rl.close();
}

main().catch(e => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});
