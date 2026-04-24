# feishu-user-plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-74-orange.svg)](#工具一览74-个)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.md) | **中文**

**全能飞书 MCP 服务器 — 75 个工具，9 个技能，三层认证，覆盖消息、文档、多维表格、知识库、云盘、OKR、日历。**

唯一支持以**你的真实身份**（而非机器人）发送飞书消息的 MCP 服务器，同时集成飞书官方 API 的全部能力。

## 特性

- **以你的身份发消息** — 消息显示你的真实姓名，不是机器人。支持文本、富文本、图片、文件、表情包和语音。
- **读取所有聊天** — 通过 Bot API 读取群聊，通过 OAuth UAT 读取私聊（单聊）。
- **全套飞书能力** — 文档、多维表格、知识库、云盘、通讯录 — 一个插件搞定。
- **自动会话管理** — Cookie 每 4 小时心跳刷新，UAT 过期自动续期。
- **群名自动解析** — 直接传群名而不用 `oc_xxx` ID，自动查找匹配。

## 为什么需要这个？

飞书官方 API 有一个硬限制：**没有 `send_as_user` 权限**。即使使用 `user_access_token`（OAuth），消息仍然显示 `sender_type: "app"` — 来自应用而不是你。

本项目将三层认证整合进一个插件：

```
用户身份 (Cookie):      你 → Protobuf → 飞书（消息显示为你本人发送）
官方 API (App Token):   你 → REST API → 飞书（文档、表格、知识库、云盘）
用户 OAuth (UAT):       你 → REST API → 飞书（读取私聊、列出所有会话）
```

**一个插件，覆盖飞书全部场景。**

## 工具一览（75 个）

完整的工具清单见 [CLAUDE.md](CLAUDE.md) 与 [CHANGELOG.md](CHANGELOG.md)。这里按类别列出主要能力：

### 用户身份 — 消息发送（逆向协议，Cookie 认证）

| 工具 | 说明 |
|------|------|
| `send_to_user` | 搜索用户 + 发送文本 — 一步到位 |
| `send_to_group` | 搜索群组 + 发送文本 — 一步到位 |
| `send_as_user` | 通过 chat ID 发消息到任意会话，支持回复线程 (`root_id` / `parent_id`) |
| `send_image_as_user` | 发送图片（需要先上传获取 `image_key`） |
| `send_file_as_user` | 发送文件（需要先上传获取 `file_key`） |
| `send_post_as_user` | 发送富文本，支持标题 + 格式化段落（链接、@提及） |
| `send_sticker_as_user` | 发送表情包 |
| `send_audio_as_user` | 发送语音消息 |

### 用户身份 — 通讯录与信息

| 工具 | 说明 |
|------|------|
| `search_contacts` | 搜索用户、机器人或群聊 |
| `create_p2p_chat` | 创建/获取单聊会话，返回数字 `chat_id` |
| `get_chat_info` | 获取群详情：群名、描述、人数、群主 |
| `get_user_info` | 通过用户 ID 查询显示名称 |
| `get_login_status` | 检查 Cookie、App 凭据和 UAT 状态 |

### 用户 OAuth UAT — 私聊读取

| 工具 | 说明 |
|------|------|
| `read_p2p_messages` | 读取私聊（单聊）消息历史，可访问机器人无法进入的会话 |
| `list_user_chats` | 列出用户参与的群聊（仅群聊，不含私聊） |

### 官方 API — 即时消息（Bot 身份）

| 工具 | 说明 |
|------|------|
| `list_chats` | 列出机器人加入的所有群 |
| `read_messages` | 读取消息历史（支持群名或 `oc_xxx` ID）。v1.3.5 自动展开 `merge_forward` 合并转发为子消息,文本自动抽取 `urls` / `feishuDocs`,图片/文件下载需用父消息 ID |
| `download_file` | 下载消息里 msg_type=file 的附件,返回 base64 + mimeType,可选 `save_path` 存盘(v1.3.5) |
| `reply_message` | 以机器人身份回复指定消息 |
| `forward_message` | 转发消息到另一个会话 |

### 官方 API — 文档

| 工具 | 说明 |
|------|------|
| `search_docs` | 按关键词搜索文档 |
| `read_doc` | 读取文档原始文本内容 |
| `create_doc` | 创建新文档 |

### 官方 API — 多维表格

| 工具 | 说明 |
|------|------|
| `list_bitable_tables` | 列出多维表格中的所有数据表 |
| `list_bitable_fields` | 列出数据表的所有字段（列） |
| `search_bitable_records` | 按条件查询记录 |
| `create_bitable_record` | 创建新记录（行） |
| `update_bitable_record` | 更新已有记录 |

### 官方 API — 知识库

| 工具 | 说明 |
|------|------|
| `list_wiki_spaces` | 列出所有可访问的知识空间 |
| `search_wiki` | 按关键词搜索知识库文档 |
| `list_wiki_nodes` | 浏览知识库节点树 |

### 官方 API — 云盘

| 工具 | 说明 |
|------|------|
| `list_files` | 列出文件夹中的文件 |
| `create_folder` | 创建新文件夹 |

### 官方 API — 通讯录

| 工具 | 说明 |
|------|------|
| `find_user` | 通过邮箱或手机号查找用户 |

## 快速开始

### 1. 克隆并安装

```bash
git clone https://github.com/EthanQC/feishu-user-plugin.git
cd feishu-user-plugin
npm install
```

### 2. 获取 Cookie

> **重要**：需要 HttpOnly 的 Cookie（如 `session`、`sl_session`），`document.cookie` 无法获取。

**方法一：Playwright 自动获取（推荐，零手动操作）**

确保已安装 Playwright MCP：
```bash
npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/mcp-server-playwright
```

然后在 Claude Code 里直接说："帮我设置飞书 Cookie"。Claude Code 会自动打开浏览器 → 你扫码登录 → 自动提取 Cookie 并写入配置。

**方法二：浏览器 DevTools（手动）**
1. 打开 [feishu.cn/messenger](https://www.feishu.cn/messenger/) 登录
2. `F12` → **Network** 标签 → 勾选 **Disable cache** → `Cmd+R` 刷新
3. 点击请求列表第一个请求 → 右侧 **Request Headers** → **Cookie:** → 右键 → **Copy value**
4. 粘贴到 `.mcp.json` 的 `LARK_COOKIE` 字段

> 不要用 `document.cookie` 或 Application → Cookies 标签 — 它们获取不到关键的 HttpOnly Cookie。

### 3. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 必需 — 用户身份消息发送（逆向协议）
LARK_COOKIE=粘贴你的Cookie

# 必需 — 官方 API（文档、表格、知识库、云盘、Bot IM）
LARK_APP_ID=cli_xxxxx
LARK_APP_SECRET=xxxxx
```

### 4. 启用私聊读取（OAuth）

`read_p2p_messages` 和 `list_user_chats` 需要 OAuth 授权：

1. 飞书应用必须是**自建应用**（非商店应用），且未启用"对外共享"
2. 添加权限：`im:message`、`im:message:readonly`、`im:chat:readonly`
3. 安全设置中添加 OAuth 重定向 URI：`http://127.0.0.1:9997/callback`
4. 运行授权：

```bash
node src/oauth.js
```

会打开浏览器进行 OAuth 授权，UAT 自动保存到 `.env`。过期后自动续期。

将生成的 `LARK_USER_ACCESS_TOKEN` 和 `LARK_USER_REFRESH_TOKEN` 也添加到 `.mcp.json` 的 env 中。

### 5. 验证

```bash
node src/test-send.js              # 检查登录状态
node src/test-send.js search 张三   # 搜索联系人
node src/test-all.js               # 运行完整测试
```

## 接入 AI 客户端

<details>
<summary><strong>Claude Code</strong></summary>

在项目 `.mcp.json` 或 `~/.claude.json` 的 `mcpServers` 中添加：

```json
{
  "mcpServers": {
    "feishu-user-plugin": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "你的飞书Cookie",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "你的应用密钥",
        "LARK_USER_ACCESS_TOKEN": "你的UAT",
        "LARK_USER_REFRESH_TOKEN": "你的RefreshToken"
      }
    }
  }
}
```

然后直接说：
- "给张三发消息说明天下午开会"
- "帮我看一下技术群最近聊了什么"
- "搜索飞书文档里关于 MCP 的内容"

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

添加到 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows）：

```json
{
  "mcpServers": {
    "feishu-user-plugin": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "你的飞书Cookie",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "你的应用密钥",
        "LARK_USER_ACCESS_TOKEN": "你的UAT",
        "LARK_USER_REFRESH_TOKEN": "你的RefreshToken"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>OpenClaw</strong></summary>

写入 `~/.openclaw/openclaw.json`（注意 key 路径是 `mcp.servers`，不是 `mcpServers`）：

```json
{
  "mcp": {
    "servers": {
      "feishu-user-plugin": {
        "command": "npx",
        "args": ["-y", "feishu-user-plugin"],
        "env": {
          "LARK_COOKIE": "你的飞书Cookie",
          "LARK_APP_ID": "cli_xxxxxxxxxxxx",
          "LARK_APP_SECRET": "你的应用密钥",
          "LARK_USER_ACCESS_TOKEN": "你的UAT",
          "LARK_USER_REFRESH_TOKEN": "你的RefreshToken"
        }
      }
    }
  }
}
```

或用 CLI：`openclaw mcp set feishu-user-plugin '{"command":"npx","args":["-y","feishu-user-plugin"],"env":{...}}'`。

> OpenClaw 自带的飞书频道（channels.feishu）负责接收消息；本插件提供用户身份发消息 + 文档/多维表格/日历/OKR 等能力，作为 OpenClaw 的补充工具层。
>
> v1.3.5+ 为 OpenClaw 场景专门硬化：同一账号被拉起多份 MCP server 时，UAT 刷新会走文件锁 `~/.claude/feishu-uat-refresh.lock` 串行化，避免 refresh_token rotation race 引发的 `invalid_grant`。详见 [prompts/openclaw-setup.md](prompts/openclaw-setup.md)。

</details>

<details>
<summary><strong>Cursor / VS Code / Windsurf</strong></summary>

配置格式类似，具体路径参见 [English README](README.md#client-setup)。

</details>

## Claude Code 技能

插件内置 9 个技能（`skills/feishu-user-plugin/`）：

| 技能 | 用法 | 说明 |
|------|------|------|
| `/send` | `/send 张三: 明天下午3点开会` | 以你的身份发消息 |
| `/reply` | `/reply 工坊群` | 读取最近消息并回复 |
| `/digest` | `/digest 工坊群 7` | 整理最近群聊消息 |
| `/search` | `/search 技术` | 搜索联系人和群组 |
| `/doc` | `/doc search MCP` | 搜索、读取或创建文档 |
| `/table` | `/table query appXxx` | 查询或创建多维表格记录 |
| `/wiki` | `/wiki search 协议` | 搜索和浏览知识库 |
| `/drive` | `/drive list folderToken` | 列出文件或创建云盘文件夹 |
| `/status` | `/status` | 检查登录和认证状态 |

安装插件后技能自动可用。

## 架构

```
┌──────────────┐                    ┌──────────────────────────────────────┐
│              │   Cookie + Proto   │  internal-api-lark-api.feishu.cn     │
│  MCP 客户端   │ ──────────────────→│  /im/gateway/ (Protobuf over HTTP)   │
│  (Claude,    │                    └──────────────────────────────────────┘
│   Cursor,    │   App Token (REST) ┌──────────────────────────────────────┐
│   VS Code)   │ ──────────────────→│  open.feishu.cn/open-apis/           │
│              │                    │  (官方 REST API)                     │
│              │   User OAuth (REST)┌──────────────────────────────────────┐
│              │ ──────────────────→│  open.feishu.cn/open-apis/           │
└──────────────┘                    │  (UAT — 私聊读取)                    │
                                    └──────────────────────────────────────┘
```

### Protobuf 命令（用户身份层）

| cmd | 操作 | Proto 消息 |
|-----|------|-----------|
| 5 | 发送消息（文本、图片、文件、富文本、表情、语音） | `PutMessageRequest` |
| 13 | 创建单聊 | `PutChatRequest` |
| 64 | 获取群信息 | `GetGroupInfoRequest` |
| 5023 | 获取用户信息 | `GetUserInfoRequest` |
| 11021 | 全局搜索 | `UniversalSearchRequest` |

## 会话与令牌生命周期

| 认证层 | 令牌 | 有效期 | 刷新方式 |
|--------|------|--------|---------|
| Cookie | `sl_session` | 12h | 每 4h 心跳自动刷新 |
| App Token | `tenant_access_token` | 2h | SDK 自动管理 |
| User OAuth | `user_access_token` | ~2h | 通过 `refresh_token` 自动续期，保存到 MCP 配置 |

Cookie 过期后（无心跳约 12-24h），需重新登录 feishu.cn 更新 `LARK_COOKIE`。使用 `get_login_status` 主动检查状态。

如果 UAT 刷新返回 `invalid_grant`，重新运行 `npx feishu-user-plugin oauth`，然后重启 Claude Code / Codex，让正在运行的 MCP server 进程加载新 token。v1.3.5+ 会在刷新前重新读取 MCP 配置；如果另一个进程已经完成 token 轮换，旧进程会采用新 token，而不是继续使用已失效的 refresh token。

## 项目结构

```
feishu-user-plugin/
├── .claude-plugin/
│   └── plugin.json          # 插件元数据
├── skills/
│   └── feishu-user-plugin/
│       ├── SKILL.md         # 主技能定义（触发条件、工具、认证）
│       └── references/      # 9 个技能参考文档 + CLAUDE.md
├── src/
│   ├── index.js             # MCP 服务器入口（75 个工具）
│   ├── client.js            # 用户身份客户端（Protobuf 网关）
│   ├── official.js          # 官方 API 客户端（REST、UAT）
│   ├── utils.js             # ID 生成器、Cookie 解析
│   ├── oauth.js             # OAuth 授权流程
│   ├── test-send.js         # 快速 CLI 测试
│   └── test-all.js          # 完整测试套件
├── proto/
│   └── lark.proto           # Protobuf 消息定义
├── .mcp.json.example        # MCP 配置模板
├── .github/                 # Issue 和 PR 模板
├── CLAUDE.md                # AI 项目指令
├── CHANGELOG.md             # 版本历史
├── CONTRIBUTING.md          # 贡献指南
├── server.json              # MCP Registry 清单
├── .env.example             # 配置模板
└── package.json
```

## 局限性

- Cookie 认证需要定期刷新（心跳自动延长至 ~12h，之后需手动重新登录）
- 依赖飞书内部 Protobuf 协议 — 飞书更新 Web 客户端可能导致失效
- 图片/文件/语音发送需要预上传获取 key（通过官方 API 或外部桥接）
- 暂无实时消息接收（WebSocket 推送尚未实现）
- `get_user_info` 部分用户可能返回 null（proto 定义限制）
- 可能违反飞书服务条款 — 使用风险自负

## 贡献

欢迎提 Issue 和 PR！开发设置、代码规范和提交指南请参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

如果飞书更新协议导致功能异常，请[提交 Issue](https://github.com/EthanQC/feishu-user-plugin/issues/new?template=bug_report.md) 并附上错误详情，我们会尽快修复。

## 许可证

[MIT](LICENSE)

## 致谢

- [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) — 飞书协议逆向工程（Python）
- [cv-cat/OpenFeiShuApis](https://github.com/cv-cat/OpenFeiShuApis) — 底层 API 研究
- [Model Context Protocol](https://modelcontextprotocol.io) — MCP 标准
