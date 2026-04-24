帮我在这台电脑上安装 OpenClaw 并配置 feishu-user-plugin。

## 第一步：安装 OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

安装完成后运行 `openclaw onboard` 完成初始化设置。

## 第二步：配置飞书频道

运行 `openclaw channels add`，选择 Feishu，填入 App ID 和 App Secret。

或者直接编辑 `~/.openclaw/openclaw.json`，在 channels 下添加：
```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "accounts": {
        "main": {
          "appId": "<APP_ID>",
          "appSecret": "<APP_SECRET>"
        }
      }
    }
  }
}
```

## 第三步：配置 feishu-user-plugin 为 MCP server

这个插件提供 75 个飞书工具（以用户身份发消息、读聊天记录（自动展开合并转发）、管理文档/多维表格/知识库/云盘/OKR/日历、上传下载图片/文件等）。

v1.3.5+ 针对 OpenClaw 这种会在短时间内拉起多个 MCP server 实例的场景做了硬化：跨进程文件锁 (`~/.claude/feishu-uat-refresh.lock`) 序列化 UAT 刷新，避免 refresh_token 被并发消耗而返回 `invalid_grant`。如果你在 OpenClaw 会话里频繁报 UAT 失败，先更新到 1.3.5 再试。

运行：
```bash
openclaw mcp set feishu-user-plugin '{"command":"npx","args":["-y","feishu-user-plugin"],"env":{"LARK_APP_ID":"<APP_ID>","LARK_APP_SECRET":"<APP_SECRET>"}}'
```

或者编辑 `~/.openclaw/openclaw.json`，在 `mcp.servers` 下添加：
```json
{
  "mcp": {
    "servers": {
      "feishu-user-plugin": {
        "command": "npx",
        "args": ["-y", "feishu-user-plugin"],
        "env": {
          "LARK_COOKIE": "<COOKIE>",
          "LARK_APP_ID": "<APP_ID>",
          "LARK_APP_SECRET": "<APP_SECRET>",
          "LARK_USER_ACCESS_TOKEN": "<UAT>",
          "LARK_USER_REFRESH_TOKEN": "<REFRESH_TOKEN>"
        }
      }
    }
  }
}
```

## 第四步：获取凭证

1. **App ID / Secret**：在 https://open.feishu.cn/app 创建自建应用获取
2. **Cookie**：登录 https://www.feishu.cn/messenger/ 后从浏览器 Network 面板获取（需要 HttpOnly cookies）
3. **UAT**：运行 `npx feishu-user-plugin oauth`（需要先完成 App ID 配置）

## 第五步：验证

```bash
openclaw mcp list        # 确认 feishu-user-plugin 出现在列表中
openclaw gateway          # 启动 OpenClaw 网关
```

启动后在飞书里给机器人发消息测试。

## 注意事项

- feishu-user-plugin 只配在 OpenClaw 的 MCP 里，不要重复安装到 Claude Code
- OpenClaw 自带的飞书频道（channels.feishu）负责接收消息，feishu-user-plugin 提供额外工具能力（用户身份发消息、文档操作等）
- Cookie 有效期 12 小时，建议配置 cron 自动续期：`0 */4 * * * npx feishu-user-plugin keepalive`
- v1.3.5+ 创建资源（`create_doc` / `create_bitable` / `create_folder` / `create_doc_block` 等）时，如果 UAT 失败插件会自动 fallback 到 bot 身份并在返回里打 `⚠️` 警告；看到警告说明资源归属于 OpenClaw 的共享 bot 而非用户本人，按警告里的提示跑 `npx feishu-user-plugin oauth` 然后重启 OpenClaw 网关。
- v1.3.5+ `read_messages` / `read_p2p_messages` 会自动把合并转发（merge_forward）消息展开为子消息。子消息里的图片/文件下载要用 `parentMessageId`（父消息 ID）而非子消息 ID，否则会报 `File not in msg`。
