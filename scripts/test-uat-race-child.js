// Child worker for test-uat-race.js. Acquires the UAT refresh lock, holds
// for a brief window (simulating the refresh + persist), then releases.
// Writes a single line to stdout: "<id> acquired <ts_ms>; released <ts_ms>"

const { LarkOfficialClient } = require('../src/official');

const id = process.argv[2] || '?';
const holdMs = parseInt(process.argv[3] || '250');

const client = new LarkOfficialClient('test', 'test');
const lockPath = client._uatLockPath();

(async () => {
  const got = await client._acquireRefreshLock(lockPath, { timeoutMs: 15000 });
  if (!got) {
    console.log(`${id} FAILED_TO_ACQUIRE`);
    process.exit(1);
  }
  const acquired = Date.now();
  await new Promise(r => setTimeout(r, holdMs));
  const released = Date.now();
  client._releaseRefreshLock(lockPath);
  console.log(`${id} acquired ${acquired}; released ${released}`);
})().catch(e => { console.log(`${id} ERROR ${e.message}`); process.exit(1); });
