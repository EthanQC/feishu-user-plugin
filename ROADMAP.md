# feishu-user-plugin Roadmap

## 已完成

### v1.0 — 核心功能
- [x] Cookie 身份消息发送（text, image, file, post, sticker, audio）
- [x] 联系人搜索、P2P 聊天创建
- [x] Official API 消息读取（bot + UAT 双路）
- [x] 文档搜索/读取/创建、Doc blocks
- [x] Bitable 基础查询（list tables/fields, search records）
- [x] Bitable 基础写入（create/update record）
- [x] Wiki 空间/搜索/节点
- [x] Drive 文件列表/创建文件夹
- [x] 联系人查找（email/mobile）
- [x] 三层认证（Cookie + App + UAT）+ 自动刷新
- [x] Playwright 自动化 Cookie 提取流程
- [x] CLI 工具（setup, oauth, status, keepalive）
- [x] CI/CD 自动发布（GitHub Actions → npm）
- [x] 9 个 Skills（/send, /reply, /digest, /search, /doc, /table, /wiki, /drive, /status）

### v1.2.1 — Bitable 完整化 + Bug 修复
- [x] upload_image / upload_file 修复（SDK multipart 响应兼容）
- [x] get_chat_info 支持 oc_xxx 格式（Official API + protobuf 双路）
- [x] create_bitable — 创建多维表格应用
- [x] create_bitable_table — 创建数据表
- [x] create/update/delete_bitable_field — 字段管理
- [x] delete_bitable_record — 单条删除
- [x] batch_create/update/delete_bitable_records — 批量操作（max 500）
- [x] list_bitable_views — 视图列表

## v1.3 — 计划中

### WebSocket 实时事件（核心方向）

**目标**：让 MCP server 能接收飞书实时事件，从"单向操作"变成"双向对话"。

**解锁的场景**：
- 对话式协作：发消息后等待对方回复，自动获取回复内容
- 群消息监控：实时监听指定群的新消息并总结
- 事件驱动：审批通过/拒绝、文档评论、日程变更等实时通知

**技术方案**：
- 飞书支持 WebSocket 长连接（仅 feishu.cn，不支持 Lark 国际版）
- 不需要公网 URL，只需出站网络
- 使用已有的 `@larksuiteoapi/node-sdk` 的 `WSClient`
- MCP server 启动时后台开 WebSocket，事件缓存到内存队列
- 新增 `get_new_events` tool，Claude 调用时返回缓存的事件

**前置条件**：
- Bot 需要在飞书开放平台后台开通事件订阅权限
- 需要设计事件缓存策略（内存上限、过期清理、隐私考量）
- 需要处理 WebSocket 断线重连

**实现清单**：
- [ ] EventBuffer 类（内存队列、容量上限、按时间/chat_id 过滤）
- [ ] WSClient 启动逻辑（集成到 main 函数，和 MCP stdio 互不干扰）
- [ ] im.message.receive_v1 事件处理
- [ ] get_new_events tool 定义和 handler
- [ ] 断线重连 + 错误处理
- [ ] 文档：事件订阅配置指南
- [ ] 可选：更多事件类型（审批、日程、文档评论）

### 多账号切换

**方案 A（推荐）**：配置文件多 Profile
- `switch_profile` / `list_profiles` 工具
- Client 和 Official 实例热重载
- Cookie 和 UAT 按 profile 独立管理

**方案 B（零代码方案）**：MCP 多实例
- 在 `~/.claude.json` 注册多个 server 实例，每个绑定不同凭证
- 优点：无需代码改动；缺点：每个实例独立进程

### 其他
- [ ] CARD 消息类型 (type=14) — 需要逆向 card JSON schema
- [ ] 消息搜索 — 按关键词搜索聊天历史
- [ ] 批量消息发送 — 群发给多个用户/群

## 已调研但暂不实施

### Token 优化（文档转 Markdown）
- `get_doc_blocks` 返回的 JSON 比等价 markdown 大 2-3x（实测 216KB vs 90KB）
- 但 `read_doc` 已返回纯文本，`get_doc_blocks` 用户就是要结构化数据
- 如有需求可加 `read_doc_markdown` 工具，使用 `feishu-docx` 做客户端转换

### Tool 数量精简
- 46 个 tool 每个消耗 550-1400 tokens（合计 25K-64K）
- Claude Code 的 Tool Search 已自动延迟加载，实测降低 46.9% 开销
- Cursor 限 40 个 tool，如需兼容再考虑拆分/合并
