#!/usr/bin/env node
// Spawn N child processes that all try to hold the UAT refresh lock
// concurrently. Verify mutual exclusion: no two hold-windows overlap.
// Exit 0 on PASS, 1 on FAIL.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const N = 4;
const HOLD_MS = 300;

const child = path.join(__dirname, 'test-uat-race-child.js');

// Clean up any stale lock from prior runs
try {
  const os = require('os');
  fs.unlinkSync(path.join(os.homedir(), '.claude', 'feishu-uat-refresh.lock'));
  console.log('(cleaned up stale lock)');
} catch (_) {}

(async () => {
  const workers = Array.from({ length: N }, (_, i) => {
    const p = spawn('node', [child, String(i), String(HOLD_MS)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', d => out += d);
    return new Promise(resolve => p.on('close', () => resolve(out.trim())));
  });

  const lines = await Promise.all(workers);
  console.log('\nraw output:');
  lines.forEach(l => console.log('  ' + l));

  const events = [];
  for (const l of lines) {
    const m = l.match(/^(\d+) acquired (\d+); released (\d+)$/);
    if (!m) continue;
    events.push({ id: parseInt(m[1]), acquired: parseInt(m[2]), released: parseInt(m[3]) });
  }

  if (events.length !== N) {
    console.log(`\n❌ expected ${N} successful workers, got ${events.length}`);
    process.exit(1);
  }

  events.sort((a, b) => a.acquired - b.acquired);
  console.log('\ntimeline (sorted by acquire):');
  events.forEach((e, i) => console.log(`  worker ${e.id}: [${e.acquired - events[0].acquired}ms .. ${e.released - events[0].acquired}ms]`));

  let ok = true;
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (curr.acquired < prev.released) {
      ok = false;
      console.log(`\n❌ OVERLAP: worker ${prev.id} held until ${prev.released}, worker ${curr.id} acquired at ${curr.acquired} (overlap ${prev.released - curr.acquired}ms)`);
    }
  }

  if (ok) {
    const totalSpan = events[events.length - 1].released - events[0].acquired;
    const expectedMin = N * HOLD_MS;
    console.log(`\n✅ mutual exclusion PASSED — ${N} workers serialised in ${totalSpan}ms (expected >= ${expectedMin}ms)`);
    process.exit(0);
  } else {
    process.exit(1);
  }
})();
