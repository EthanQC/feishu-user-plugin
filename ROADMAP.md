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

### v1.3.0 — SDK 全功能覆盖 (30 new tools, 46→76)
- [x] Bot 主动发消息 (`send_message_as_bot`)
- [x] 消息撤回/编辑 (`delete_message`, `update_message`)
- [x] 表情回复 (`add_reaction`, `delete_reaction`)
- [x] 消息置顶 (`pin_message`, `unpin_message`)
- [x] 群组管理 (`create_group`, `update_group`, `list_members`, `add_members`, `remove_members`)
- [x] 文档内容编辑 (`create_doc_block`, `update_doc_block`, `delete_doc_blocks`)
- [x] Bitable 补全 (`get_bitable_record`, `delete_bitable_table`)
- [x] 云盘文件操作 (`copy_file`, `move_file`, `delete_file`)
- [x] 日历管理 (`list_calendars`, `create_calendar_event`, `list_calendar_events`, `delete_calendar_event`, `get_freebusy`)
- [x] 任务管理 (`create_task`, `get_task`, `list_tasks`, `update_task`, `complete_task`)

### v1.3.x — 稳定性 + Codex + 发布安全 + Bitable 补全
- [x] fix: Lark SDK logger 重定向到 stderr（MCP 断连根因修复）
- [x] fix: 进程级 uncaughtException / unhandledRejection 兜底
- [x] fix: persistToConfig 原子写入（防 Claude Code 读写竞态）
- [x] feat: Codex TOML 配置支持（setup --client codex/both）
- [x] feat: 发布三层版本确认（Claude 规则 + prepublishOnly + CI tag 校验）
- [x] feat: get_bitable_meta / copy_bitable / update_bitable_table / create_bitable_view / delete_bitable_view

### v1.3.3 — 掉线根治 + APP_ID 校验 + 图片读取
- [x] fix: 全局 `console.log` / `console.info` 重定向到 stderr（防任何依赖意外污染 MCP stdio）
- [x] fix: 所有 `fetch` 加 `AbortController` 超时（默认 30s），避免 Feishu API 卡住导致 MCP 客户端超时断链（这是 v1.3.2 仍偶发掉线的真因）
- [x] fix: `create_doc` / `create_bitable` / `create_folder` 的 `(as user)` 标签现在按 UAT 调用是否真成功打标，不再仅看 `hasUAT`；UAT 失败时明确显示 `(as app — UAT unavailable or failed; X owned by the app, not you)`
- [x] feat: 启动时探测 `LARK_APP_ID` / `LARK_APP_SECRET` 有效性，无效时在 stderr 报错并指向团队 README；非阻塞（用户可能只用 cookie 身份）
- [x] feat: `get_login_status` 返回 APP_ID + 应用名，便于一眼看出配的是不是团队官方 app
- [x] feat: `download_image` tool — 通过 message_id + image_key 下载消息里的图片，以 MCP image content 形式回传，模型能直接看到像素（不再只拿到 key 字符串）

### v1.3.4 — Wiki 贯通 + 文档图片读写 + OKR + 日历 + 外部群降级硬化
- [x] feat: 统一 ID resolver（`src/resolver.js`）— 所有 docx/bitable 工具的 id 参数透明接受原生 token / wiki node / Feishu URL，10 分钟 LRU 缓存
- [x] feat: `get_wiki_node` 工具 — 单独暴露 wiki node → obj_token+obj_type 解析
- [x] feat: `create_doc` / `create_bitable` 支持 `wiki_space_id`(+ `wiki_parent_node_token`) 直接挂进 Wiki，走 `move_docs_to_wiki`
- [x] feat: `download_image` 新增 docx 图片模式（`doc_token` + `image_token`），走 `drive/v1/medias/<token>/download`
- [x] feat: `create_doc_block` / `update_doc_block` 新增 `image_path` / `image_token` 快捷参数，内部完成"占位块 + media upload + replace_image patch"三步走
- [x] feat: `src/doc-blocks.js` — docx block 构造器骨架，为 v1.3.5 本地 md 同步预留
- [x] feat: OKR 读取 — `list_user_okrs` / `get_okrs` / `list_okr_periods`
- [x] feat: 日历读取 — `list_calendars` / `list_calendar_events` / `get_calendar_event`
- [x] fix: `read_messages` / `read_p2p_messages` 降级硬化 — 响应加 `via` + `via_reason` 字段；`src/error-codes.js` 按错误码路由（外部租户 / 权限 / 不在群 → UAT；频控 / 5xx / ECONNRESET → 退避 2s 重试再 UAT）；search_contacts 预判的外部群跳过 bot
- [x] fix: 无 UAT 时不再直接抛 Feishu 原始 payload，改为指向 `npx feishu-user-plugin oauth` 的清晰错误信息
- [x] fix: `_uatREST` 支持数组 query 参数（OKR `period_ids`、`okr_ids` 等需要重复 key）

### v1.3.5 — UAT race 硬化 + Fallback 告警 + merge_forward 展开

- [x] fix: UAT refresh 跨进程文件锁（`~/.claude/feishu-uat-refresh.lock`，O_CREAT|O_EXCL，30s stale detection）。多 MCP 进程并发刷新时严格串行化，进入临界区后再重读已持久化配置；后到的进程 adopt 胜者的新 token,不重复消耗已轮换的 refresh token
- [x] fix: UAT refresh 前重读已持久化配置（JWT exp 解析 + `_adoptPersistedUATIfNewer` 双层保险）
- [x] fix: `get_login_status` 真调一次 `listChatsAsUser` 验证 UAT,不再只报告 token 已配置
- [x] feat: `_asUserOrApp` 静默 fallback 到 bot 写操作时返回 `fallbackWarning`,handler 在 MCP 响应里以 ⚠️ 显式提示"资源归属 bot 不是你,跑 oauth 然后重启"
- [x] feat: `read_messages` / `read_p2p_messages` 自动展开 `merge_forward` 占位。通过 `GET /im/v1/messages/{parent_id}` 拉子消息数组,子消息挂 `parentMessageId` / `originChatId` / `upperMessageId`,保留原始 sender / time
- [x] feat: `read_messages` 文本消息自动抽取 `urls` 数组;飞书文档链接进一步归入 `feishuDocs`,让 agent 直接喂 `read_doc` / `get_doc_blocks`
- [x] feat: 新增 `download_file` 工具,下载消息里 msg_type=file 的附件(base64 + 可选 save_path)。merge_forward 子消息的 image/file 必须用父消息 ID 下载
- [x] feat: `scripts/test-uat-race.js` — 多进程锁争抢的验证脚本(4 worker spawn,断言互斥 + 时间线不重叠)
- [x] chore: 一次性清理 28 份 bot-owned 文档 / bitable / 空壳文件夹(遗留的 fallback 创建残留),留下 7 份 Obsidian 同步脚本参考 + 数学摇滚知识库同步

### v1.3.6 — 上传完整化 + 多账号 + batch_send + send_card_as_user (bot-default)

- [x] 上传能力完整化
  - `uploadDocMedia` → `uploadMedia` 通用化,支持 8 种 parent_type(docx/sheet/bitable × image/file + doc_image/doc_file 兼容)
  - docx file block 写入:`create_doc_block` 多 `file_path` / `file_token`,`update_doc_block` 多 `file_token`。处理飞书自动用 view 容器(block_type=33)包裹 file 块(block_type=23)的坑——先查内层再 replace_file
  - 新增 `upload_drive_file` 工具:`drive/v1/files/upload_all` parent_type=explorer,支持 `wiki_space_id` 直接挂到 wiki(走 `attachToWiki(obj_type=file)`)
  - 新增 `upload_bitable_attachment` 工具:`uploadMedia` with parent_type=bitable_image/bitable_file,返回的 file_token 可直接塞进 Bitable Attachment 字段
- [x] OAuth scope 扩充:加 `drive:file:upload`、`sheets:spreadsheet`(team app 后台同步开通并发布 v3.7.0)
- [x] `batch_send` 工具:多目标 fan-out(text/image/file/post),按 delay_ms 节流,per-target ok/error
- [x] 多 profile:`list_profiles` / `switch_profile` 工具,通过 `LARK_PROFILES_JSON` 注册多套凭证,热切换不重启
- [x] `send_card_as_user`(bot-default):via=bot 走 `send_message_as_bot('interactive', card)`,via=user 在 v1.3.6 显式返回 deferred 错误。一旦 v1.3.7 实现 user-identity 卡片必须**移除 bot-default**

### v1.3.7 — 计划中

#### 逆向工程任务(从 v1.3.6 推迟)

- [ ] `send_card_as_user` 真·用户身份(从 v1.3.6 推迟)— 录飞书 web 客户端发卡片时的 protobuf payload,实现 type=14 用户身份发送。**实现完成后必须删除 v1.3.6 的 bot-default 兜底**(handler 里 via=bot fallback)
- [ ] `search_messages` — 按关键词搜聊天历史。先试 UAT `/open-apis/im/v1/messages/search` 是否存在,不存在则逆向 cookie 路径

#### 本地 md 同步(从 v1.3.4/1.3.6 拆出再推迟)

- [ ] 本地 md → 飞书知识库同步
  - md parser 依赖选型(remark / markdown-it / unified)
  - `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
  - wikilink `[[page]]` 解析:按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
  - 图片内联:md `![alt](./img.png)` → 复用 `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
  - 文件附件 inline:md `[xxx.pdf](./xxx.pdf)` → 复用 `file_path` 快捷
  - CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
  - 增量 diff:已存在 wiki 节点的更新策略(全量覆盖 / 按 block_id 精细 diff)

#### WebSocket 实时事件

让 MCP server 接收飞书实时事件,从"单向操作"变成"双向对话"。

**解锁场景**:
- 对话式协作:发消息后等待对方回复,自动获取回复内容
- 群消息监控:实时监听指定群的新消息并总结
- 事件驱动:审批通过/拒绝、文档评论、日程变更等实时通知

**技术路径**:
- 飞书 WebSocket 长连接(仅 feishu.cn,不支持 Lark 国际版)
- 出站网络即可,无需公网 URL
- 复用 `@larksuiteoapi/node-sdk` 的 `WSClient`
- MCP server 启动时后台开连接,事件缓存到内存队列,`get_new_events` 工具拉取

**实现清单**:
- [ ] EventBuffer 类(内存队列、容量上限、按时间 / chat_id 过滤)
- [ ] WSClient 启动逻辑(集成到 main,和 MCP stdio 互不干扰)
- [ ] `im.message.receive_v1` 事件处理
- [ ] `get_new_events` 工具定义和 handler
- [ ] 断线重连 + 错误处理
- [ ] 文档:事件订阅配置指南
- [ ] 可选:更多事件类型(审批、日程、文档评论)

## 已调研但暂不实施

### Token 优化(文档转 Markdown)
- `get_doc_blocks` 返回的 JSON 比等价 markdown 大 2-3x(实测 216KB vs 90KB)
- 但 `read_doc` 已返回纯文本,`get_doc_blocks` 用户就是要结构化数据
- 如有需求可加 `read_doc_markdown` 工具,使用 `feishu-docx` 做客户端转换
