#!/usr/bin/env node
/**
 * Pre-publish version confirmation gate.
 * Runs as prepublishOnly — blocks `npm publish` until version is confirmed.
 * Automatically skipped in CI (GitHub Actions handles tag/version check separately).
 */

if (process.env.CI || process.env.GITHUB_ACTIONS) {
  process.exit(0);
}

const readline = require('readline');
const pkg = require('../package.json');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log(`\n  Package:  ${pkg.name}`);
console.log(`  Version:  ${pkg.version}`);
console.log(`  Tools:    ${pkg.description}\n`);

rl.question(`  Confirm publish v${pkg.version}? (y/N): `, (answer) => {
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') {
    console.error('\n  Publish cancelled. Update version in package.json if needed.\n');
    process.exit(1);
  }
  console.log('  Confirmed. Proceeding with publish...\n');
});
