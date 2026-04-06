# Contributing to feishu-user-plugin

Thanks for your interest in contributing! This document provides guidelines for contributing to this project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/feishu-user-plugin.git`
3. Install dependencies: `npm install`
4. Copy config: `cp .env.example .env` and fill in your credentials
5. Verify setup: `node src/test-send.js`

## Development

### Project Structure

```
src/
├── index.js        # MCP server entry point (tool definitions + routing)
├── client.js       # User identity client (Protobuf gateway)
├── official.js     # Official API client (REST + UAT)
├── utils.js        # Shared utilities
├── oauth.js        # OAuth authorization flow
├── oauth-auto.js   # Automated OAuth with Playwright
├── test-send.js    # Quick CLI test
└── test-all.js     # Full test suite
```

### Running Tests

```bash
node src/test-send.js              # Quick login check
node src/test-all.js               # Full test suite (sends real messages)
```

> **Note**: `test-all.js` sends actual messages to Feishu. Use a test group.

### Code Style

- No build step — plain Node.js with CommonJS modules
- Minimal dependencies — only `@larksuiteoapi/node-sdk`, `@modelcontextprotocol/sdk`, `protobufjs`, `dotenv`
- Error messages should be actionable (tell the user what to do)

## Submitting Changes

> **Important**: Direct pushes to `main` are blocked. All changes must go through a Pull Request with CI passing.

1. Create a feature branch: `git checkout -b feature/my-change`
2. Make your changes
3. Test with `node src/test-all.js`
4. Run syntax check: `node -c src/index.js && node -c src/official.js`
5. Commit with a descriptive message
6. Push your branch and open a Pull Request
7. Wait for CI checks to pass, then merge

### Commit Messages

Follow conventional format:
- `fix: correct timestamp parsing in _formatMessage`
- `feat: add card message type support`
- `docs: update tool descriptions in README`

## Reporting Issues

When reporting bugs, please include:
- Node.js version (`node -v`)
- Error message (full stack trace)
- Which tool/function failed
- Whether it's a cookie auth issue (check with `node src/test-send.js` first)

### Protocol Changes

Feishu may update their internal web protocol at any time. If something stops working:
1. Open an issue with the error details
2. Include the `cmd` number and proto message name if possible
3. Check if the web client at feishu.cn/messenger still works

## Adding New Tools

1. Add the tool definition to the `TOOLS` array in `src/index.js`
2. Add the handler in the `switch` block in `handleTool()`
3. Implement the underlying method in `client.js` (user identity) or `official.js` (official API)
4. Update `server.json` with the new tool
5. Test and update README

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
