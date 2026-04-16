#!/usr/bin/env node

const { spawn } = require('child_process');

const defaultCommand = ['node', '/Users/abble/feishu-user-plugin/src/index.js'];
const childCommand = process.argv.slice(2);
const [command, ...args] = childCommand.length > 0 ? childCommand : defaultCommand;

const child = spawn(command, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

let parentMode = null; // 'content-length' | 'newline'
let parentInBuffer = Buffer.alloc(0);
let childOutBuffer = '';

function writeToParent(jsonLine) {
  if (parentMode === 'content-length') {
    const body = Buffer.from(jsonLine, 'utf8');
    process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
    process.stdout.write(body);
    return;
  }
  process.stdout.write(jsonLine + '\n');
}

function handleParentMessage(message) {
  const line = typeof message === 'string' ? message : JSON.stringify(message);
  child.stdin.write(line + '\n');
}

function tryParseParentBuffer() {
  while (parentInBuffer.length > 0) {
    if (parentMode === 'content-length' || (!parentMode && parentInBuffer.includes(Buffer.from('\r\n\r\n')))) {
      parentMode = 'content-length';
      const headerEnd = parentInBuffer.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd === -1) return;
      const headerText = parentInBuffer.subarray(0, headerEnd).toString('utf8');
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        process.stderr.write('[mcp-bridge] Missing Content-Length header\n');
        process.exit(1);
      }
      const bodyLength = Number(match[1]);
      const totalLength = headerEnd + 4 + bodyLength;
      if (parentInBuffer.length < totalLength) return;
      const body = parentInBuffer.subarray(headerEnd + 4, totalLength).toString('utf8');
      parentInBuffer = parentInBuffer.subarray(totalLength);
      handleParentMessage(body);
      continue;
    }

    parentMode = 'newline';
    const newlineIndex = parentInBuffer.indexOf(0x0a);
    if (newlineIndex === -1) return;
    const line = parentInBuffer.subarray(0, newlineIndex).toString('utf8').replace(/\r$/, '');
    parentInBuffer = parentInBuffer.subarray(newlineIndex + 1);
    if (line.trim()) handleParentMessage(line);
  }
}

process.stdin.on('data', (chunk) => {
  parentInBuffer = Buffer.concat([parentInBuffer, chunk]);
  tryParseParentBuffer();
});

child.stdout.on('data', (chunk) => {
  childOutBuffer += chunk.toString('utf8');
  while (true) {
    const newlineIndex = childOutBuffer.indexOf('\n');
    if (newlineIndex === -1) break;
    const line = childOutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
    childOutBuffer = childOutBuffer.slice(newlineIndex + 1);
    if (line.trim()) writeToParent(line);
  }
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.stderr.write(`[mcp-bridge] Child exited via signal ${signal}\n`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  process.stderr.write(`[mcp-bridge] Failed to spawn child: ${error.message}\n`);
  process.exit(1);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
