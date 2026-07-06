# feishu-user-plugin —— 飞书 MCP 服务器 + CLI 工具

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-85-orange.svg)](docs/TOOLS.md)
[![npm](https://img.shields.io/npm/v/feishu-user-plugin.svg)](https://www.npmjs.com/package/feishu-user-plugin)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**中文** · [English](README.en.md) · [Docs](https://zhuzhen-team.github.io/memory-system/) · [CHANGELOG](CHANGELOG.md) · [npm](https://www.npmjs.com/package/feishu-user-plugin)

飞书 / Lark MCP 服务器，覆盖 IM、文档、多维表格、知识库、云空间、日历、任务 v2、OKR、实时事件。**85 工具 · 3 层鉴权 · 9 MCP prompts · MIT licensed · Node ≥18**。

兼容 Claude Code、Codex、Cursor、Windsurf、VS Code、Claude Desktop、OpenClaw 等 MCP 客户端。

用户身份发消息有两条路径：**飞书官方 OAuth scope `im:message.send_as_user`**（需要创建自建应用 + 管理员审批），或本仓的 **cookie + protobuf 路径**（cookie 抓出来就跑）。本仓不再是物理性独家，但仍然是"个人开发者 / 没有管理员权限 / 想快速试用户身份发消息"场景的简便选项。

> ⚠ **注意限定范围**：cookie 路径"零应用门槛"只对**纯文本 / post 类用户身份发消息**严格成立：`send_to_user` / `send_to_group` / `send_as_user` / `send_post_as_user` / `batch_send`（text/post 模式）5 个工具。`send_image_as_user` / `send_file_as_user` 的发送本身走 cookie，但 `image_key` / `file_key` 必须先经 Official API（`upload_image` / `upload_file`）上传；`send_card_as_user` 服务端禁了 cookie 通道，始终走 bot。本仓其他能力（读群消息、操作文档 / 表格 / 知识库 / 云空间 / 日历 / 任务 / OKR / 实时事件等）也**仍然需要创建飞书自建应用**（`LARK_APP_ID` + `LARK_APP_SECRET`），跟官方 MCP / CLI 完全一样。

## 与官方对比（飞书 2026 年也发了 MCP + CLI）

- [`larksuite/lark-openapi-mcp`](https://github.com/larksuite/lark-openapi-mcp) —— 官方 OpenAPI MCP，**⚠ Beta** + 最后更新 2025-08（9 个月前），README 明文不支持文件上传下载、不支持文档编辑；1271 个 endpoint 工具但 preset.default 仅 ~20，其余"未做兼容性测试"
- [`larksuite/cli`](https://github.com/larksuite/cli) —— 官方 CLI（9.9k stars，活跃），17 业务域 200+ commands + 24 AI Agent Skills，**已支持 `+messages-send --as user`**（走 OAuth scope `im:message.send_as_user`），但 **CLI 形态而不是 MCP**，Codex / Cursor / Windsurf 等用它要 shell out

**什么时候用本仓**：

- 想以用户身份发消息 / 读 P2P 私聊但**不想 / 不能创建飞书自建应用**（个人开发者 / 没管理员权限）—— cookie 路径零门槛
- 用 MCP 协议（Codex / Cursor / Windsurf / VS Code 等）+ 不需要邮件 / 审批 / HR / 会议纪要等本仓未覆盖的域
- 多 MCP 客户端共存且需要"实时事件全机精确投递一次"（v1.3.9+ 机器级 WS SSOT）

**什么时候用官方**：需要邮件 / 审批 / 考勤 / HR / 招聘 / 会议纪要等业务系统域；或已有飞书应用 + 管理员批了 OAuth scope，偏好官方长期稳定路径。

完整诚实对比见 [docs/COMPARISON.md](docs/COMPARISON.md)。

## 用法

```
你：帮我以我身份给王小明发：今天的代码 review 我看完了，有 3 个 nit
Claude：[调用 send_to_user]  Sent
```

```
你：总结"工程组"群今天 9 点之后的讨论，发个日报到 #日报频道
Claude：[read_messages → 总结 → send_to_group]  Sent
```

## 安装

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
npx feishu-user-plugin oauth         # 拿用户 OAuth UAT
# 重启 Claude Code / Codex
```

cookie 获取（Playwright 自动扫码 / DevTools 手动）、创建飞书应用、各客户端配置详见 [docs/AUTH-SETUP.md](docs/AUTH-SETUP.md)。

## 三层鉴权

| 鉴权层 | 凭证 | 覆盖能力 | 工具数 |
|---|---|---|---|
| 用户身份（cookie + protobuf） | `LARK_COOKIE` | 以用户身份发文本 / 图片 / 文件 / 富文本 / @ / 批量 | 8 |
| 官方 API（机器人） | `LARK_APP_ID` + `LARK_APP_SECRET` | 群消息读写、文档、多维表格、知识库、云空间、日历、任务 v2、OKR、联系人、实时事件 WS | 70+ |
| 用户 OAuth UAT | `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` | P2P 私聊读取、用户 chat 列表；写入文档 / Bitable / 日历 资源时以用户为 owner | 2 显式 + 全工具 UAT-first |

三层独立 —— 配置任意一层，对应工具可用。

## 核心能力

- **以你身份发消息**（8）：text / image / file / 富文本 post / 卡片 / 批量；差异化锚点 —— 飞书官方 API 没有 `send_as_user`
- **读群与 P2P 私聊**（17）：群消息 / 私聊 / `merge_forward` 自动展开 / URL + 飞书文档链接自动提取 / 外部群自动 fallback 到 UAT
- **文档生态**（27）：飞书文档（含 `read_doc_markdown` 省 ~60% token）/ 多维表格（500 条批量）/ 知识库（含 write CRUD）/ 云空间
- **协作工具**（21）：日历（读+写）/ 任务 v2（含成员管理）/ OKR（读+进展记录）/ 联系人
- **实时事件**（2）：机器级 SSOT WS，每条事件全机精确投递一次
- **诊断与多账号**（4）：N 个 profile 自动切换，写路径不切（避免错号建资源）

完整工具列表 + 跨域 caveat + 用法 patterns 见 [docs/TOOLS.md](docs/TOOLS.md)。

## 9 个 MCP prompts（slash commands）

| Prompt | 说明 |
|---|---|
| `/send` | 以用户身份发消息 |
| `/reply` | 读最近消息然后回 |
| `/digest` | 群 / P2P 最近消息总结 |
| `/search` | 搜联系人 / 群 |
| `/doc` | 搜 / 读 / 建文档 |
| `/table` | 操作多维表格 |
| `/wiki` | 搜知识库 |
| `/drive` | 列云空间 / 建文件夹 |
| `/status` | 检查三层鉴权状态 |

## 客户端配置

环境变量统一，配置文件位置和顶层键不同：

| 客户端 | 配置文件 | 顶层键 |
|---|---|---|
| Claude Code | `~/.claude.json`（推荐全局）/ `.mcp.json` | `mcpServers.feishu-user-plugin` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) | `mcpServers.feishu` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.feishu-user-plugin]` |
| Cursor | `.cursor/mcp.json`（项目级） | `mcpServers.feishu` |
| VS Code (Copilot) | `.vscode/mcp.json` | `servers.feishu`（注意 `servers`，非 `mcpServers`） |
| OpenClaw | `~/.openclaw/openclaw.json` | `mcp.servers.feishu-user-plugin` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers.feishu` |

```bash
npx feishu-user-plugin setup                       # Claude Code
npx feishu-user-plugin setup --client codex        # Codex
npx feishu-user-plugin setup --client both         # 都写
```

各客户端完整 JSON 模板见 [README.en.md `MCP Client Configuration`](README.en.md#mcp-client-configuration)；详细安装与凭证流程见 [docs/AUTH-SETUP.md](docs/AUTH-SETUP.md)。

## 多账号

`~/.feishu-user-plugin/credentials.json` 支持多 profile（默认 + 任意附加），单台机器一处配置覆盖多个飞书账号 / 多个企业。

```bash
npx feishu-user-plugin list-profiles
npx feishu-user-plugin switch-profile <name>
npx feishu-user-plugin keepalive --all       # 跨 profile keepalive
```

读路径工具失败码 `91403` / `1254301` / `1254000` / `99991672` / `HTTP 403` 时自动跨 profile retry。写路径不自动切（避免错号创建资源）。单调用覆盖：传 `via_profile: "<name>"` 钉到指定 profile。

详见 [docs/TOOLS.md "多 profile auto-switch"](docs/TOOLS.md#多-profile-auto-switchv138)。

## 实时事件

机器上单进程持有 WS owner 锁，所有 MCP 进程共享 `events.jsonl`，每条事件全机恰好一次。

```bash
mcp call manage_ws_status --action info
mcp call manage_ws_status --action claim --force true
```

默认订阅 `["im.message.receive_v1"]`。要订阅审批 / 日历 / vc 等其他事件，编辑 `credentials.json::profiles[<active>].events`，然后 `manage_ws_status(action=reconfig)` 不重启重新订阅。

仅支持 feishu.cn —— Lark 国际版（lark.com）的 WSClient 当前不支持。

## 已知限制

- **Cookie 寿命**：12-24 小时无心跳过期，需重新登录 feishu.cn 拿 cookie
- **协议变化**：cookie + protobuf 层依赖飞书 web 客户端的协议，飞书更新可能失效（机器人能力不受影响）
- **卡片**：cookie 通道发卡片服务端不可用，机器人通道可发
- **Lark 国际版**：实时事件 WS 不支持
- **已删除**：md → wiki 双向同步（飞书 wiki block schema 离散度高，无损往返不现实）、Mermaid → 飞书画板（依赖 wiki 主线一并删）。详见 [ROADMAP.md](ROADMAP.md) 的"已删除"段

## 文档

| 文档 | 角色 |
|------|------|
| [docs/TOOLS.md](docs/TOOLS.md) | 工具详细 + 跨域 caveat + 用法 patterns |
| [docs/AUTH-SETUP.md](docs/AUTH-SETUP.md) | 安装 / 三层鉴权 / Cookie 抓取 / OAuth Scopes |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 错误码与诊断 |
| [docs/RELEASING.md](docs/RELEASING.md) | 发版流程 + team-skills 同步 + 公告规则 |
| [docs/REFACTOR-NOTES.md](docs/REFACTOR-NOTES.md) | 文件职责矩阵 |
| [docs/CREDENTIALS-FORMAT.md](docs/CREDENTIALS-FORMAT.md) | 凭证 schema |
| [docs/TESTING-METHODOLOGY.md](docs/TESTING-METHODOLOGY.md) | 测试方法 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献流程（中英双语） |
| [ROADMAP.md](ROADMAP.md) | 路线图（forward-only） |
| [CHANGELOG.md](CHANGELOG.md) | 历史变更 |

完整 docs/ 索引：[docs/README.md](docs/README.md)。

## 贡献

Issues / PR 欢迎。提交前先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

飞书改协议导致功能挂掉 —— 开 issue 带错误日志即可。

## 隐私 / Privacy

本地运行的 MCP 服务器，凭证留在用户本机，不上报遥测，不与插件作者后台通信。完整文本见 [PRIVACY.md](PRIVACY.md)。

- **收集**：插件本身不收集任何数据；`LARK_COOKIE` / `LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_USER_ACCESS_TOKEN` / `LARK_USER_REFRESH_TOKEN` 全部由用户主动配置，来源于用户自己的飞书 / Lark 账号
- **处理**：仅处理用户通过 MCP 工具调用主动请求的消息 / 文档 / 多维表格 / 知识库 / 云空间 / 日历 / 任务 / OKR / 联系人，不留存、不分析
- **存储**：`~/.feishu-user-plugin/credentials.json`（mode 0600）；可选事件日志 `~/.feishu-user-plugin/events.jsonl`（10 MB / 20 MB 自动轮转）
- **第三方**：仅与用户自己的飞书租户和用户运行的 AI 客户端通信，无 CDN / 分析 / 错误上报
- **保留**：完全用户控制；`rm -rf ~/.feishu-user-plugin && npm uninstall -g feishu-user-plugin` 即清空
- **联系**：[GitHub Issues](https://github.com/EthanQC/feishu-user-plugin/issues)，安全问题在 issue 标题前加 `[security]`

A locally-run MCP server. Credentials stay on the user's machine; no telemetry, no phone-home. Full text at [PRIVACY.md](PRIVACY.md).

- **Collected**: nothing by the plugin itself; the five `LARK_*` envs are supplied by the user from their own Feishu / Lark account
- **Processed**: only the messages / docs / bitable / wiki / drive / calendar / tasks / OKR / contacts the user explicitly requests via MCP tool calls
- **Stored**: `~/.feishu-user-plugin/credentials.json` (mode 0600); optional event log at `~/.feishu-user-plugin/events.jsonl`
- **Third-party**: only the user's own Feishu tenant and the AI client the user runs (Claude Code / Codex / Cursor / etc.)
- **Retention**: entirely user-controlled; `rm -rf ~/.feishu-user-plugin && npm uninstall -g feishu-user-plugin` removes everything
- **Contact**: [GitHub Issues](https://github.com/EthanQC/feishu-user-plugin/issues); security disclosures with `[security]` prefix in the title

## License

[MIT](LICENSE)

## 致谢

- [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) —— 早期飞书 web 协议研究（Python）
- [cv-cat/OpenFeiShuApis](https://github.com/cv-cat/OpenFeiShuApis) —— 底层 API 研究
- [Model Context Protocol](https://modelcontextprotocol.io) —— MCP 标准 + Anthropic / PulseMCP / GitHub / Stacklok 共维 registry
