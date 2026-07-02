# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.4.1] - 2026-07-02

一轮 v1.4.0 后全仓审计的收口补丁：修掉 setup 覆盖损坏 `~/.claude.json` 的数据丢失路径、加固进程级错误处理器的日志、补齐 v1.4.0 遗留的文档漂移（任务 scope、按 profile 事件游标）。85 工具 + 9 prompts 不变，无 breaking API。

### Fixed
- **setup 不再覆盖损坏的 `~/.claude.json`（数据丢失 guard）**：`npx feishu-user-plugin setup` 遇到既有 `~/.claude.json` 解析失败（如手改多了个逗号）或内容不是 JSON 对象（`null` / 数组 / 字面量）时，此前 `catch {}` 吞错后以 `config={}` 原子覆盖，抹掉你其它所有 `mcpServers` 条目、`projects` 历史与设置。现新增 `_readJsonConfigOrThrow`：文件不存在 / 空文件 → 安全新建；非法或非对象 JSON → 抛清晰错误并拒绝覆盖。Codex `config.toml` 读路径同样区分「文件不存在」与「权限 / IO 读失败」，后者不再当空文件覆盖。（src/config.js）
- **进程级错误处理器有界、永不自伤日志**：`uncaughtException` / `unhandledRejection` 此前直接 `console.error(err.stack)`；抛出 / rejected 的值若不是 Error（`message` / `stack` 为 undefined），或是超大 / 循环对象，格式化本身可能在 handler 内再抛，把单次故障放大成 handler→格式化→再抛的自伤循环。现统一走 `logger.inspectError`：Error 投影为 `name` / `message` / `code` / `stack`，总输出硬封顶 8000 字符（多 key 对象与大数组也截断），任何情况不抛。落地外部 PR #110 中维护者已批准的 `util.inspect` 安全部分，不含其被 request-changes 的 SIGKILL 跨进程清理 / `ps` reaping / 重入计数。（src/logger.js、src/server.js）

### Changed
- **文档漂移收口**：`docs/TOOLS.md` / `docs/AUTH-SETUP.md` 把 v1.4.0 已拆分的任务 scope 从旧的 `task:task` 更正为 `task:task:read` / `task:task:write`（照旧文档配会 provision 到已不存在的 scope）；实时事件游标文档改为按 profile 独立的 `events.cursor.<profile>.json`（`*` / `any` 用全局游标）。`src/tools/tasks.js`、`src/clients/official/tasks.js` 的 scope 注释同步更正。ROADMAP 标题刷新到 v1.4.0+，记录 #110 安全部分已内部落地。（docs/、ROADMAP.md、src/tools/tasks.js、src/clients/official/tasks.js）

### Test scenarios
- 用一个含语法错误的 `~/.claude.json`（如尾逗号），或写入 `null` / `[]` 后跑 `setup`：应报错并保留原文件字节不变，而不是覆盖
- 触发一次 `unhandledRejection`（reason 为超大对象）：stderr 日志应被截断到约 8 KB，且进程不崩

## [1.4.0] - 2026-06-19

本版是一轮多 agent 全仓深度体检后的可靠性收口：写路径的 UAT→bot 身份漂移全部显形、多 profile 切换不再污染跨进程单点真源、实时事件按 profile 独立游标互不吞、cookie 假成功被堵、OAuth 加 state 防护、任务 scope 粒度化。85 工具 + 9 prompts 不变，无 breaking API。升级后重启 Claude Code / Codex 自动拉 v1.4.0。

### Changed

- **OAuth scope 粒度化 (task)**：飞书把 `task:task` 拆为 `task:task:read` + `task:task:write`，`src/oauth.js::SCOPES` 改请求这两枚。命中旧 scope 的任务工具此前返回 99991679（用户态）/ 99991672（应用态）「请重新授权」，看着像 UAT 掉了实为 scope 覆盖缺口。**需在应用后台开通 `task:task:read` / `task:task:write`（`search:message` 同样需开通），再重跑 `npx feishu-user-plugin oauth`**。（src/oauth.js、docs/AUTH-SETUP.md）
- **OAuth 回调超时可配**：新增 `FEISHU_OAUTH_TIMEOUT_MS` 覆盖默认 120s（换账号 / 补 scope 的 consent 需要更长时间）。（src/oauth.js）
- **error-codes**：补 `99991672`（`oauth_scope_not_granted`）分类；注明 `1254000 / 1254301` 被飞书跨 API 复用（上传重试 vs bitable 读切 profile），两条路径永不撞同一调用点，非矛盾。（src/error-codes.js、src/auth/profile-router.js）

### Fixed

- **写路径 UAT→bot ownership 漂移全部显形 (簇C)**：`complete_task` / `delete_task`、bitable `update*` / `delete*` client + `text()` handler、`read_doc_markdown` 此前丢弃 `viaUser` / `fallbackWarning`，bot fallback 与 user 成功无从区分。现统一透传并在响应顶部点名；`read_doc_markdown` 在空块（bot fallback 静默隐藏个人空间文档）时也带告警。（src/tools/tasks.js、src/clients/official/bitable.js、src/tools/{bitable,docs}.js）
- **多 profile auto-switch 不再污染 SSOT (簇A)**：读路径试探切换改为纯内存 `setActiveProfileEphemeral`，不再把试探 profile 写进 `credentials.json::active`（峰值会让并发读进 fsync 级写 + SHA + hook 扇出，且崩溃残留切错身份）；恢复放进 `finally` 保证异常也还原；`keepalive --all` 改 `_persistProfile` 定向持久化、不翻全局 active。`[autoSwitched]` 只在真 failover 标注、陈旧 hint 命中即清。（src/auth/profile-router.js、src/server.js、src/cli.js）
- **get_new_events 不再丢事件**：`drain` 按 `max_events` 有界消费，被截断的尾巴留存待下次取（此前游标跳到 EOF 永久丢）；每个 profile 独立游标文件（`events.cursor.<profile>.json`），一个 profile 轮询不再吃掉另一 profile 未读事件（`*`/`any` 仍用全局 cursor）；`_system` 事件投递给所有 profile。（src/events/{cursor,event-log}.js、src/tools/events.js）
- **events 单 owner 选举检测被夺锁**：长期锁带 `ownerToken`，`heartbeat()` 仅在仍持有时刷新——force-steal（rename + 重建）后 `utimesSync` 仍成功会留幽灵双写者，现能检测并主动让位重选；轮转 rename + 游标 reset 进同一 cursor 锁原子化；ENOSPC 丢事件落 `_events_dropped` 标记；`withMutex` 忙等改 `Atomics.wait` 不再冻结 event loop；`repairTail` 扫描窗口随大尾增长。（src/events/{lockfile,cursor,ws-server,event-log}.js、src/server.js）
- **cookie 假成功被堵 (簇B)**：`search` / `createChat` / `getGroupInfo` 此前丢弃网关 `ok` 标志，把 cookie 过期 / 限流的失败读成空结果，现非 2xx 抛错；`_resolveCookieChatId` 解析 `oc_xxx` 要求唯一精确匹配（此前取第一个同名群可能误发到不相关群），且缓存按 profile 分键（`switch_profile` 后不复用旧 numeric id）。（src/clients/user.js、src/tools/messaging-user.js）
- **credentials 写并发安全**：`read-modify-write` 串行化到跨进程文件锁，cookie 心跳与 UAT 刷新不再互相覆盖丢字段。（src/auth/credentials.js）
- **Codex config 改写不再损坏相邻内容**：`_removeTomlServer` 的贪婪正则（`args=["…"]` 里的 `[` 致残留 / 末段吞到 EOF）换成 TOML 表感知逐行删除，保留无关 table 与用户注释。（src/config.js）
- **一批 nit**：`getBlockChildren` 分页（>500 格表不再 abort）；`manage_bitable_record` 强制 ≤500；`manage_doc_block(create)` 空 `children:[]` 不再算选中 mode；`contacts` 名字缓存按 `id-type` 分键；`im.js` `code:0` 空 `data` 守卫；`buildCtx` 每调用单次构建；`im-read` 包裹 cookie search 错误；`get_wiki_node` 回退改 token 驱动（不再依赖易漏的错误码正则）；`setup.js` pointer-only 日志改用 `harnessActive`；`smoke` 失败时保留 server stderr。

### Security

- **OAuth loopback 回调加 state CSRF 校验**：`/callback` 只接受本次随机生成的 `state`，挡跨站 / 过期 code 注入（OAuth 2.0 §10.12）；开浏览器从 `execSync` 改 `execFileSync` 去 shell；token 交换错误页对 `err.message` / `scope` 做 HTML 转义。（src/oauth.js）
- **下载内存守卫**：`download_message_resource` 在 `arrayBuffer()` 前按 `Content-Length` 卡 50 MiB，挡超大 / 恶意附件 OOM。（src/clients/official/im.js）
- **save_path 校验**：拒相对路径与 null 字节，对齐「绝对路径」契约。（src/tools/diagnostics.js）
- **cookie 报错脱敏**：非 ASCII cookie 校验报错不再回显 40 字符 cookie 片段（可能含 `sl_session` 等 session 字节）。（src/clients/user.js）

### Test scenarios

- 调用 `complete_task` / `delete_task`，bot fallback 下观察响应带 `fallbackWarning` / `(as app)`，UAT 成功时干净无标记
- 多 profile 下并发 `get_new_events`：各 profile 独立收到自己的事件互不吞；单次 `max_events` 截断后尾部下次仍能取到
- 应用开通 `task:task:read` / `task:task:write` + 重新 `oauth` 后，`list_tasks` / `create_task` 可用（此前 99991679 / 99991672）

## [1.3.17] - 2026-06-08

本版围绕读路径完整性做一轮系统性收口：大文档与大列表不再静默截断、批量写的部分失败不再被读作全成功、文档表格 / 媒体块建失败可定位可修复。85 工具数不变，`get_doc_blocks` / `manage_doc_block` / `read_messages` / `read_p2p_messages` / `list_wiki_nodes` / `manage_bitable_record` 等 schema 新增分页或上报字段，无 breaking API。升级后重启 Claude Code / Codex 自动拉 v1.3.17。

### Added

- **get_doc_blocks / read_doc_markdown 分页拉全量**：跟进 `page_token` 拉完整块树，`hasMore:false` 才代表拉全；此前单页静默截断在 500 块，大文档（一次报障是 280+ 块 / ~300KB）尾部"消失"且无任何标志，调用方误以为那部分块没建成功。`get_doc_blocks` 新增 `max_blocks` 限定单次返回 + `nextPageToken` 续拉，被限定的返回带 `truncated:true`；`read_doc_markdown` 块树不完整时末尾追加 `[output truncated]` 注记。（src/clients/official/docs.js）
- **read_messages / read_p2p_messages / list_wiki_nodes / manage_bitable_record(search) 分页续拉**：四条读路径新增 `page_token` 入参，`hasMore:true` 时把返回的 `pageToken` 回填即可翻页；此前 client 已返回游标但工具层丢弃 / schema 无入参，超出单页窗口（消息默认 20 上限 50、wiki 节点 50、bitable 默认 20）的内容拿不到也续不了，digest / 全表扫描类任务据此得出残缺结论。
- **manage_members(add) 部分失败上报**：新增 `notExistedIds`（用户不存在）/ `pendingApprovalIds`（卡入群审批、尚未进群），任一非空时响应顶部 ⚠ 逐一点名；此前只透 `invalidIds`，后两类被静默吞掉，半失败读作全员入群（卡审批的"成员"后续 @ 不到）。字段名对照飞书 OpenAPI 生成的 SDK 类型核验。（src/clients/official/groups.js）

### Fixed

- **manage_doc_block 建表填格部分失败可恢复**：mode F 填格遇瞬态错误（`code=2200` scope-check 抖动 / 限频 / 5xx）自动退避重试；重试后仍失败的格子记录 `failedCells:[{row,col,cellId,textBlockId,reason,skipped}]`（row/col 0 起算）随成功结果返回、不再整体抛错，连续 3 格失败止损并标 `skipped`。逐格 `action=update`（block_id 传 textBlockId）补内容即可，不必重建表。一次报障是 7×3 表第 6 行起填格失败、整表残缺且拿不到已填清单。（src/clients/official/docs.js）
- **list_wiki_spaces 拉全量**：内部跟进 `page_token` 拉完整空间列表；此前单页截断在 50，第 51+ 个空间的 `space_id` 无法发现，后续 `list_wiki_nodes` / `create_wiki_node` 选不到 parent。（src/clients/official/wiki.js）
- **图片 / 文件块三步建块瞬态重试 + 孤儿可定位**：`createDocBlockWithImage` / `createDocBlockWithFile`（建占位块 → 上传 → PATCH）的上传与 PATCH 步骤自动重试瞬态错误；持续失败时错误携带占位块 `blockId`（上传已成功时附媒体 token + 含 `document_id` 的修复指引），不必全文找空块。（src/clients/official/docs.js）
- **空页不再当分页终止信号**：飞书因权限过滤可能返回空页 + `has_more:true` 但后面还有数据（其 `spaceNode.list` API 文档明确写"可以继续分页请求"）；`getDocBlocks` / `listWikiSpaces` 内部循环不再在空页停（停滞保护改由 token 守卫 + 页数 backstop），空页 + 前进游标继续翻。`list_wiki_nodes` schema 同步提醒 agent 空页 + hasMore 要续翻。（src/clients/official/docs.js、wiki.js）
- **error-codes：2200 归类 retry**：docx 的 "check incr user_access_token scope fail" 是 scope-check 服务的瞬态抖动（同一 UAT 前序调用均成功、scope 本已授权），归为可重试。（src/error-codes.js）
- **server.json 目录描述词边界截断**：registry catalog 描述改为词边界截断 + 省略号，不再切在半个词（32 个长描述受益）；运行时 MCP client 经 `tools/list` 拿的仍是完整描述。（scripts/sync-server-json.js）

### Changed

- **update_text_elements 整段替换语义强调**：`manage_doc_block(action=update)` 的 `update_text_elements` 全量覆盖该块的 elements（**非** patch / append），漏传的 element（加粗前缀、链接等）永久丢失；改局部应先 `get_doc_blocks` 读原块、整组传回。schema 描述 + docs/TOOLS.md + CLAUDE.md + skill reference 四处加粗。

### Test scenarios

- 280+ 块大文档调 `get_doc_blocks` 应返回全部块、`hasMore:false`；`read_doc_markdown` 渲染到末段不截断
- `read_messages` 对消息密集的群 `hasMore:true` 时回填 `page_token` 应拿到更早的消息
- `manage_doc_block(action=create, table=7×3)` 21 格应全部填充；瞬态失败时返回 `failedCells` 而非整体报错
- `list_wiki_spaces` 在加入 >50 个空间的账号应返回全部、`hasMore:false`

## [1.3.16] - 2026-06-06

修掉发现类读路径的身份盲区：上传到个人空间的文件此前找不到、也因此删不掉。`list_files` / `search_docs` / `search_wiki` / `get_wiki_node` 四条读路径改为 UAT 优先（bot fallback 保留）。85 工具数不变，list_files / search_docs / search_wiki 三个 schema 新增分页参数，无 breaking API。

### Added

- **list_files 看得见你的个人空间了（用户报障修复）**：此前 `list_files` 走纯 app token，bot 对个人空间（"我的空间"）文件夹 403，导致 `upload_drive_file` 走 UAT 传上去的文件**不可发现、也不可删除**（`manage_drive_file(action=delete)` 需要的 file_token 拿不到）。现在 UAT 优先、bot fallback：配置 UAT 后空 `folder_token` 列你自己的"我的空间"根目录。新增 `page_size` / `page_token` 入参与 `nextPageToken` 返回；root 空结果且走 bot 路径时附 `scopeHint` 解释 bot root ≠ 我的空间。（`src/clients/official/drive.js`）
- **search_docs / search_wiki 分页游标**：新增 `page_size` / `offset` 入参，`hasMore` 时返回 `nextOffset` 直接回填即可翻页；此前只有 `hasMore` 没有可用游标，截断的尾部恰好可能藏着要找的个人空间文档。异常的 `has_more:true` 空页不发 cursor，防止翻页死循环。坏参数（NaN / 负数）收敛为非负整数后才发给飞书。

### Changed

- **search_docs / search_wiki / get_wiki_node 改 UAT-first**：suite 搜索 API 只索引调用身份可见的内容，app 身份搜不到个人空间文档（报障里上传的 PDF 就是这样消失的）。三条路径与 `list_files` 一并走 `_asUserOrApp`（UAT 优先、bot fallback，被迫走 bot 时返回 ⚠ fallbackWarning），响应统一带 `viaUser` 标明视角归属。`get_wiki_node` 保持裸 node 返回形状（resolver 兼容），additive 附加 `viaUser` / `fallbackWarning`；obj_token 合成正则不受新错误形状影响（953001 与 live 实测 131005 双分支测试钉死）。
- **依赖升级**：protobufjs 7.5.6 → 8.6.0（cookie protobuf 发送层经真实发送探针 + 读回验证）；`@larksuiteoapi/node-sdk` 1.63.1 → 1.66.0（official API 读路径实测）。
- **MCP Registry namespace** 指向 `io.github.zhuzhen-team`（仓库迁移收尾）。

### Test scenarios

- 配置 UAT 后调 `list_files`（空参）应列出你"我的空间"根目录且 `viaUser:true`
- `upload_drive_file` 上传 → `list_files` 拿 file_token → `manage_drive_file(action=delete)` 删除 → 再 `list_files` 确认消失
- `search_docs` 搜个人空间上传的 PDF 标题应能命中，`page_size`+`offset` 翻页两页无重叠

## [1.3.15] - 2026-05-31

两条增强：文档建表格不再让 agent 猜 block_type；UAT 频繁重新授权的根因（良性 refresh_token 轮换竞态被误判为撤销）修掉。无 schema 变化、无新工具（仍 85）、无 breaking API。升级后重启 Claude Code / Codex 自动拉 v1.3.15。

### Added

- **manage_doc_block 新增 table 创建模式（mode F）**：`manage_doc_block(action=create, table={rows, columns, cells?, column_width?, header_row?, header_column?})` 一步建表 + 填格。此前 agent 要自己拼 table block 并猜 `block_type`（猜成 40 → 飞书报 `invalid_param`）；现在插件内部建 `block_type=31` 表、由飞书自动生成 `block_type=32` 单元格、逐格 UPDATE 单元格自带的空文本块（无遗留空块）。单元格 ID 行优先解析自创建响应，回退到 scoped `getBlockChildren`（不吃整文档 500 块上限），解析不全则报错而非静默丢内容。返回 `tableBlockId` + 行优先 `cells` 网格。`skills/feishu-user-plugin/references/doc.md` 同步补建表 + 决策树指引。

### Fixed

- **UAT refresh `invalid_grant` 良性轮换竞态自愈**：频繁收到飞书"授权操作通知"、"没撑过一晚上"的根因。飞书 refresh_token 每次刷新滚动轮换；当跨进程互斥失效时（20s 锁超时兜底，或 v1.3.14 升级期间新旧锁路径 `~/.claude/feishu-uat-refresh.lock` vs `~/.feishu-user-plugin/uat-refresh.lock` 不对齐），并发刷新的输家拿 `invalid_grant`，此前 `refreshUAT` 直接判 `UAT_REVOKED` 并提示重跑 oauth——而赢家此刻早已把有效新 token 落盘。现在 `invalid_grant` 时先快照已发送的 refresh_token、回查磁盘，若已有"不同且仍有效"的 token（peer 赢了轮换）就采用并恢复，只有磁盘也是同一个死 token 才真判撤销；按 client 状态判定（而非 `adoptPersistedUATIfNewer` 返回值）兼顾 in-process / credentials-monitor hot-reload race。（`src/auth/uat.js`）

### Test scenarios

- 多进程 / 多版本并发刷 UAT 时，良性轮换不再弹"授权操作通知"、不再提示重跑 oauth（`auth_time` 不跳）
- `manage_doc_block(action=create, table={rows:2,columns:2,cells:[["A","B"],["C","D"]]})` 在文档里生成 2×2 表、四格有内容、无空行

## [1.3.14] - 2026-05-21

**TL;DR**：纯收紧的 bug fix / security release。无 schema 变化、无新工具、无 breaking API。升级后重启 Claude Code / Codex 自动拉 v1.3.14；如果之前还没跑过 `migrate --confirm`，**强烈建议**跑一次（canonical store 是 v1.3.7+ 推荐路径，v1.3.14 把 UAT refresh 锁也搬过来完成最后一块）。

OAuth / UAT 子系统深度优化：跨进程互斥锁路径迁移到 canonical home、cookie heartbeat 改为 ws-owner 单跑（30+ 并发 session 不再每 4h × N 倍 API call 进飞书 session-keepalive 端点）、refresh 错误处理与 identity 状态机打通（invalid_grant 显式 `err.uatRevoked` → `_classifyUatFailure` 短路成 UAT_REVOKED → `withIdentityFallback` 给 LLM 清晰的"请重跑 oauth"指引）、安全敏感日志清理（含 OAuth 回调浏览器页面 token bytes 不再显示）、Lark Desktop reactor 冷启动 debounce 修复、decodeTokenExpiry 失败 breadcrumb flood-gate、dead code 移除、TROUBLESHOOTING 四段新指引、新增 27 个 fixture-based 测试（test-uat-lifecycle 18 + test-cookie-heartbeat 9）并修复 v1.3.7 起就静默坏掉的跨进程 race 测试。85 工具 9 prompts 不变。

### Security

- **oauth.js: redact `code` field in token-exchange log**（`src/oauth.js:166`）：之前 `console.log` 把 authorization code 明文写 stdout。code 短寿命（~60s）但仍是可换 token 的有效 credential，转写 / 屏幕录制 / 终端 history 会暂存。改为 `code: '***'`。
- **oauth.js: 浏览器回调页面不再显示 access_token bytes**（`src/oauth.js:251`）：之前 `<p>access_token: ${tokenData.access_token.slice(0, 20)}...</p>` 把 token 前 20 字节贴到 HTML，浏览器 history / 截图 / 屏幕录制都会留痕。改为 `<p>access_token: ✅ 已获取（${len} chars）</p>` —— 长度 attestation 足以证明流程成功，不暴露 token 任何 byte。
- **删除 `src/oauth-auto.js`**：Playwright dev-only OAuth helper，v1.3.0 起没有 production path 引用、`.npmignore` 排除发包，但仍 `console.log(raw.slice(0, 300))` 把完整 access_token + refresh_token 写 stdout，对 contributor 是误导。整文件移除，doc 引用同步更新。
- **uat.js refreshUAT 错误消息不再 dump 整个响应 JSON**（`src/auth/uat.js:160-180`）：飞书部分错误路径会在响应体里 echo 回 refresh_token 字段，之前 `JSON.stringify(data)` 会把这些 bytes 抛到 Error.message → 冒泡到 MCP `content[0].text` → LLM transcript。改为只透 `data.error_description / data.msg / data.code` 结构化字段（`errCode`/`errMsg` 解构）；invalid_grant 单独走 hardcoded `'UAT refresh_token rejected by Feishu (invalid_grant). The 7-day refresh chain is broken. Run: npx feishu-user-plugin oauth to re-authorize.'`，无任何 `data` 字段 interpolation。
- **identity-state.js `_classifyUatFailure` redact 兜底 + uatRevoked 短路**（`src/auth/identity-state.js:88-105`）：(1) 加 `if (uatError.uatRevoked) return UAT_REVOKED` 短路 —— refreshUAT 抛 invalid_grant 时设的 flag 现在真正驱动状态机（之前 flag 设了但 classifier 不读，是 dead metadata）；(2) 在 `viaReason` 拼接前用 regex `replace(/[A-Za-z0-9._-]{40,}/g, '<redacted>')` 把任何 40+ 字符的 base64-ish 串清掉。defense-in-depth on top of refreshUAT 自己的清理。两条都有 fixture 测试覆盖（test-uat-lifecycle 第 15-16 case）。

### Fixed

- **Cookie heartbeat 改为 ws-owner 单跑（v1.3.14 架构 root cause D 配套）**（`src/auth/cookie.js:30-50`）：pre-v1.3.14 每个 MCP server 进程独立跑自己的 4 小时 cookie heartbeat timer，10+ 个并发 Claude Code / Codex / OpenClaw session 在一台机器上意味着每 4 小时 N 倍并发请求到飞书的 session-keepalive 端点。改为 owner-gated：只有持有 `ws-owner.lock` 的进程做真实 heartbeat + 写新 cookie 到 credentials.json；非 owner 进程的 timer tick 是 no-op。非 owner client 通过 v1.3.12 的 `CredentialsMonitor.onCookieChange` hook 在下次 tool call 时自动重建 userClient 拿新 cookie。Fallback：如果 ws-owner.lock 不存在（APP_ID/SECRET 没配 → WS server 未启 → 没人 claim），所有进程都跑 heartbeat（pre-v1.3.14 行为），保证 cookie-only 部署不受影响。每次 tick 重新检查 owner 身份，ws-owner 切换时自适应。
- **UAT refresh 跨进程锁路径迁移到 canonical home**（`src/auth/uat.js:98` `uatLockPath()`）：从 `~/.claude/feishu-uat-refresh.lock` 搬到 `~/.feishu-user-plugin/uat-refresh.lock`。原因：Codex-only 用户没有 `~/.claude/` 目录，`mkdirSync` 会隐式创建空 dir 但 lock 文件没法跨 harness 真正互斥 → 30+ MCP server 并发 lazy refresh 时绕过文件锁 → 各自发 refresh API → 飞书侧 RT rotation 抢占 → `invalid_grant` 雪崩。新路径跟 `ws-owner.lock` 同 dir，所有 harness（Claude Code / Codex / OpenClaw / scripts）走同一把锁。`scripts/test-uat-race.js` 4 worker 验证：~1500ms 串行完成，无 overlap。
- **invalid_grant 触发 identity state machine UAT_REVOKED**（`src/auth/uat.js:170-178` + `src/auth/identity-state.js:88-95`）：refreshUAT 拿到 `error: invalid_grant` 或 `code: 20064` 时**两条路径都执行**：(1) 直接调 `_refineIdentity(client, UAT_REVOKED)` 改 cache，(2) 抛 `err.uatRevoked = true`，由 `_classifyUatFailure` 短路成 UAT_REVOKED 让 `withIdentityFallback` 后续无论谁先到都正确分类。`fallbackWarning` 从含糊的 "UAT 不可用" 升级为 "UAT 已被撤销 (invalid_grant)... 运行 `npx feishu-user-plugin oauth` 后重启"。错误消息也明确 "The 7-day refresh chain is broken"。
- **三层 adoptPersistedUATIfNewer 检查避免重复 refresh**（`src/auth/uat.js:114-148`）：锁外预检（短路 peer 已经写过的新 token）→ 锁失败再检（lock contention 期间 peer 完成）→ 锁内再检（acquireRefreshLock 返回到自己开始 refresh 之间的窗口）。10+ MCP server 进程同时 lazy refresh 时大幅减少向飞书侧的并发请求数，进一步降低 RT rotation 冲撞。
- **withUAT retry 后也走 auth-code 检查**（`src/auth/uat.js:194`）：第一次 fn() 抛网络错时 `classifyError` 说 retry，**之前** retry 结果直接 return；**现在**让 retry 后的 response 也通过 `data.code === 99991663/99991668/99991677` 判断，触发 refresh 后再 retry。fix 一个静默走漏：peer 进程在 retry 间隙做了 RT rotation 后，本进程内存 RT 失效，retry response 携带 auth-related code 之前不会触发 refresh。
- **OAuth + setup 所有 `fetch` 调用加 `timeoutMs`**（`src/oauth.js` 4 处 + `src/setup.js:106`）：之前裸 `fetch`，socket 卡死会让 `npx oauth` / `npx setup` 永久挂。Ctrl-C 重跑同一 authorization code 已被消费必失败。改为 `fetchWithTimeout` with 10-15s timeout。
- **scripts/test-uat-race-child.js 修复跨进程 race 测试**（v1.3.7 静默坏掉）：原 child 调用 `client._uatLockPath() / _acquireRefreshLock()`，但 v1.3.7 phase A 把这些方法从 `LarkOfficialClient` 抽到 `src/auth/uat.js` 模块。pre-fix child 启动即 `TypeError`，4 个 worker 全部失败但 race test 报 `expected 4 successful workers, got 0` 时大家以为是环境问题。改为直接 import `uat.js::uatLockPath / acquireRefreshLock / releaseRefreshLock`。
- **credentials-monitor.js `forceInvalidate` 在 canonical 不存在时 `_initialized` 没翻转**（`src/auth/credentials-monitor.js:177`）：之前 `_initialized` 只在 sync() 内部 set；forceInvalidate 时如果 canonical 不存在（用户手动删/移动文件），`_initialized` 仍是 false → 下次 sync() 文件出现会被当 baseline → 应该 fire 的 hook 被静默吞掉。修法：forceInvalidate 末尾无条件 `_initialized = true`。
- **server.js Lark Desktop reactor 冷启动 debounce**（`src/server.js:86-89` + `_runLarkDesktopReactor` first-tick init）：之前 `_lastSwitchAt = 0` module-global，长时间运行的 owner 进程突然死掉后新 owner 接管，新 owner 的 `_lastSwitchAt` 是 0 → detectSwitch debounce 失效 → 冷启动第一次 tick 会把长期 pre-existing 的 Lark Desktop snapshot 当 "刚刚切换" 误触发 profile flip。修法：reactor 首次 tick 时若 `_lastSwitchAt === 0` 自动 stamp 为 `Date.now()`，给冷启动跟长跑 owner 一样的 debounce baseline。
- **decodeTokenExpiry 失败 breadcrumb flood-gate**（`src/auth/uat.js:31-46`）：之前每次 `getValidUAT` 调用都会 decode `_uat`（因为 `_uatExpires = 0` 在解码失败后还是 falsy → 下次又 decode），如果 token 持续 malformed 会每个 tool 调用都向 stderr 打一行 warning。改为按 token sha256 hash 去重：每个 distinct 坏 token 只打一次，1024 entry cap 防 OOM。两个新 test case 验证 "same bad token 5 次只 log 1 次" + "3 个不同 bad token 各 log 1 次"。

### Changed

- **`LarkOfficialClient.loadUAT()` 标 `@deprecated` + 内部简化**（`src/clients/official/base.js:25-35`）：保留向后兼容 `src/test-all.js` 与外部 caller；新代码统一走 `src/server.js::loadUATFromEnv(client, env)` 从 credentials.json profile 或 harness env 读，不读 `process.env`。函数体也清掉了 v1.3.13 留下的死表达式（`parseInt(token ? ... : '0')` 表面像 guard 实际无效，code-review 期间删干净）。`server.js` 旁边的 "Mirror of LarkOfficialClient.loadUAT()" 注释更新成正向描述。
- **`cli.js keepalive` 不再污染 `process.env`**（`src/cli.js:251`）：之前 `--all` 循环里写 `process.env.LARK_USER_ACCESS_TOKEN` 但不还原。注释还说"让 LarkOfficialClient.loadUAT() picks the right tokens"，但实际 loadUAT 没被调用（v1.3.7 起 keepalive 直接赋实例字段）—— 既是 dead 操作又是 dead 注释。删干净。
- **`src/test-all.js` 自动从 canonical store backfill `process.env`**：v1.3.7+ 用户走 canonical store 后 `process.env.LARK_*` 多半为空，`npm test` 入口的 cookie / UAT 初始化会 sanity fail。加 `backfillFromCanonical()` 让 `npm test` 在没 export env vars 的 shell 直接跑通。

### Added

- **新测试套件 `src/test-uat-lifecycle.js`（18 个 case）**：unit + mock-fetch，覆盖 decodeTokenExpiry（well-formed / missing payload / malformed base64 / no exp / flood-gate same-token-only-warns-once / flood-gate different-tokens-each-warn-once）、acquireRefreshLock（fresh / contention timeout / stale recovery）、releaseRefreshLock 容忍重复释放、adoptPersistedUATIfNewer（no canonical / same token / newer access / rotated refresh）、refreshUAT（invalid_grant 抛 `err.uatRevoked=true`、99991663 transient 不设 uatRevoked）、identity-state `_classifyUatFailure`（redact regex 真实 exercise long token-like string、uatRevoked flag 短路成 UAT_REVOKED）。接入 `npm test` 进 PR gate。
- **新测试套件 `src/test-cookie-heartbeat.js`（9 个 case）**：覆盖 `_isHeartbeatRunner` 在 6 种 lock 状态（ws-owner=self / ws-owner=other / lock missing / lock body malformed / pid 缺失 / pid 类型错）+ `_heartbeatTick` 在 3 种 owner 状态下的实际调用决策（non-owner 跳过、owner 成功 refresh + persist、owner network 失败但不 persist 不抛）。`_heartbeatTick` 函数从原 `setInterval` callback 抽出，让 tick path 可在 unit 测里直接 invoke 不必等 4 小时 timer。接入 `npm test`。
- **`src/auth/uat.js` 新增 export `uatLockPath / acquireRefreshLock / releaseRefreshLock`**：仅供测试 harness 用（明确标注非稳定 API），让 lifecycle test + cross-process race test 不依赖 client 实例方法。
- **`src/auth/identity-state.js` 新增 export `_classifyUatFailure`**：仅供测试用，让 redact regex + uatRevoked short-circuit 两条路径直接被 fixture 测到。
- **`src/auth/env-backfill.js`（新文件）**：从 canonical credentials store backfill `process.env.LARK_*`，给 legacy 路径（`loadUAT()` 读 `process.env`）兜底。提取自 v1.3.14 初版加在 `test-all.js` 顶部的 closure；现在被 `test-all.js` / `test-comprehensive.js` / `scripts/probe-feishu-docx.js` / `scripts/test-wiki-attach-fallback.js` 共用，统一 6 个 `LARK_*` keys backfill 范围（之前 `probe-feishu-docx.js` 只 backfill 2 key，缺 `LARK_UAT_EXPIRES`；现在统一）。`shell-export LARK_* > .env > canonical` 的优先级保留。

### Docs

- **`docs/TROUBLESHOOTING.md` 加 4 个高频 troubleshooting 段**：（1）"频繁收到飞书授权操作通知" —— 给 JWT `auth_time` 字段诊断命令 + 区分 fresh consent vs silent refresh vs 飞书 server 侧策略变化；（2）"Token 已过期但 MCP 没自动刷新" —— uat-refresh.lock stale 检查 + canonical store 校验 + manual `keepalive`；（3）"v1.3.14 升级期间混合版本（短暂窗口）" —— 旧 v1.3.13 + 新 v1.3.14 同时跑 5 分钟内的 lock 路径不对齐风险 + 恢复步骤；（4）"migrate 后老 env 凭证还在被读" —— 重启 + 清 stale fallback 字段步骤。`UAT refresh invalid_grant` 现有段补 v1.3.14 锁路径变化说明 + canonical hot-reload 期望。
- **`README.md:147` "已删除" 条目补 reason inline**：之前只写"详见 ROADMAP"，现在显式说明 md → wiki 因 wiki block schema 离散度高、Mermaid → 画板因依赖 wiki 主线一并删，不必跳出 README 就能理解。
- **`src/auth/cookie.js` 文件头注释精简**（17 行 → 7 行）：保留核心机制说明（owner-gated + non-owner reload path + fallback），删掉营销腔的"10+ concurrent" 阐述（CHANGELOG 已有详述）。
- **`src/error-codes.js:31` 注释 "30-day window" → "7-day refresh-token window"**：飞书 v2 OAuth refresh_token 实际寿命 7 天滚动续期（与 `docs/AUTH-SETUP.md:29` / `docs/COMPARISON.md:52` / `src/oauth.js:255` 浏览器回调文案对齐）。这一处历史错文档跟其他 doc 一直矛盾，本版收口。
- **`README.md:147` 删除 "未实现：search_messages"**：v1.3.12 已实装，CLAUDE.md 当时改了但 README 漏改。换成 "已删除：md → wiki 双向同步、Mermaid → 画板"。
- **`docs/AUTH-SETUP.md:30` ws-owner.lock stale 时长 "30 秒" → "60 秒"**：与 `src/events/owner.js:14 STALE_MS = 60_000` 实际值对齐 + 补 v1.3.12 PID liveness check 说明（SIGKILL'd owner 即时回收，不必等 mtime）。同段加新行：`~/.feishu-user-plugin/uat-refresh.lock`（v1.3.14 起）+ 历史路径备注。
- **`src/oauth.js:255` 浏览器回调 HTML 文案 "30天有效" → "7天有效，每次 refresh 滚动续 7 天"**：澄清滚动续期语义 —— 活跃用户的 refresh_token 永远不过期，`keepalive` cron 只为关闭客户端 >7 天的场景。
- **`SECURITY.md:58` + `prompts/openclaw-setup.md:36` lock path 同步更新**：跟 v1.3.14 canonical 路径一致 + 保留历史路径备注。
- **`docs/REFACTOR-NOTES.md:29` 删除 `oauth-auto.js` 引用**：随文件删除，行内说明改成 `OAuth CLI 流程（v1.3.14 起 oauth-auto.js Playwright helper 已删除）`。
- **`prompts/openclaw-setup.md:34` 工具数 "84 个" → "85 个"**：跟主仓 README + SKILL.md 已经标的 85 对齐，pre-existing drift 顺手收口。
- **`prompts/openclaw-setup.md:36` 升级命令 "更新到 1.3.14" → "`npm i -g feishu-user-plugin@latest`"**：避免每发新版本都得回头改这条 dev doc。
- **`ROADMAP.md` 标题 "v1.3.13+ 待办" → "v1.3.14+ 待办"**。
- **`docs/RELEASING.md` Step 2 明确列出 6 处版本号 bump**：之前文档说"4 个，mcp-registry + mcpb 由 check 脚本单独校验"——这表述让 v1.3.14 release 漏了这 2 个 bump 直到 CI 警告才发现。改为显式列 6 处 + 各 check 脚本范围，避免后续 release 重蹈覆辙。

### Release engineering

- **6 个版本号 source 全 bump**：`package.json` / `.claude-plugin/plugin.json` / `.cursor-plugin/plugin.json` / `skills/feishu-user-plugin/SKILL.md` / `mcp-registry.json`（含 `packages[0].version`） / `.mcpb/manifest.json`。`server.json` 由 `sync-server-json.js` regen。
- **10 个 CI gate 全通**：`check-version` / `check-tool-count` / `check-description-drift` / `check-mcp-registry-version` / `check-mcpb-version` / `sync-server-json` / `check-changelog` / `check-scopes` / `check-broken-links` / `check-docs-sync`（validate.yml + publish.yml + prepublishOnly 三个 workflow 跑全套）。

### Test scenarios

- `npm test`（在没有 export `LARK_*` env vars 的 shell）→ **83 个 fixture pass / 0 fail**（含 e2e 18 PASS / 15 SKIP / 0 FAIL + test-uat-lifecycle 18 + test-cookie-heartbeat 9 + lark-desktop 13 + display-label 8 + 既有命名单元 17）
- OAuth 流程浏览器回调页面 source view → access_token 行只显示 `✅ 已获取（N chars）` 不含任何 token byte
- 触发持续 malformed UAT 场景（手动 corrupt token in canonical, 调 N 个 UAT 工具）→ stderr 只一条 `decodeTokenExpiry: malformed JWT` 警告，N-1 条被 dedupe
- `node scripts/test-uat-race.js`（4 worker 跨进程抢锁）→ **mutual exclusion PASSED**，4 worker 串行 ~1500ms，无 overlap（典型 1500-1520ms，依赖系统负载；4 × 300ms hold + 调度开销）
- `node scripts/check-scopes.js` → `OK (31 OAuth + 1 tenant-only scopes, 2 banned names guarded)`
- `npm run smoke` → `OK: 85 tools, 9 prompts, login_status shape matches`
- `npx feishu-user-plugin oauth` 之后浏览器页面文案：`refresh_token: ✅ 已获取（7天有效，支持自动续期；每次 refresh 滚动续 7 天）`
- 模拟 invalid_grant：next UAT tool call 的 `_fallbackWarning` 包含 `UAT 已被撤销 (invalid_grant)... 运行 \`npx feishu-user-plugin oauth\` 后重启`
- 升级后短暂出现 `~/.feishu-user-plugin/uat-refresh.lock`（refresh 时；30 秒 stale 自动回收）

## [1.3.13] - 2026-05-16

紧急 patch — v1.3.12 release 后 Codex + Copilot PR #103 review 发现 1 P1 + 2 P2 + 5 polish，followup 又跑 5-agent 全仓 audit 找出 2 P1 (security) + 多个 doc/compliance 漂移。本版集中修复全部 issue + 把 fixture-based unit tests 拉进 CI gate。

> **包含 v1.3.12 全部能力**（4 个 architectural root cause 收口 + `search_messages` UAT-only 工具 + CLI 工具模式 + SEO 改造 + 工程质量 + 战略性微调，85 工具）+ 以下修复。建议跳过 v1.3.12 直接升 v1.3.13。

### Security

- **oauth.js token leak（P1）**：`exchangeCode()` 之前会 `console.log('Token exchange raw response:', raw.slice(0, 500))` —— 完整 access_token + refresh_token 进 stderr。`saveToken()` 失败 fallback 路径还会 `console.error('  ${k}=${v}')` 把整个 token 字符串 dump 出来。改成只 log HTTP status + body 长度；fallback 用 `slice(0,6)…(N chars)` redact pattern（同 credentials.js migrate 风格）。

### Fixed

- **P1 — UAT-success 路径错标 viaUser:false（影响 v1.3.12 全部 UAT 写工具）**：`src/auth/identity-state.js` withIdentityFallback UAT 成功路径返回 shallow clone of response，但漏 set `_viaUser: true`。15+ `_asUserOrApp` callsites (calendar/docs/bitable/wiki/okr/tasks/drive) 读 `res._viaUser` 决定显示，没设的话全部 v1.3.12 UAT-owned 写显示 `viaUser:false` + 无 fallbackWarning，用户误以为 bot 创建。Fix：shallow-clone 时加 `_viaUser: true`，加 test-identity-state 断言 pin contract。

- **P2 — credentials hot-reload 启动期空窗**：server.js main() 现在启动时调一次 `credMonitor.sync()`（在 verifyApp() 拿 officialClient 之后）。Pre-fix 第一次 sync 永远 silent baselining；server boot 跟 first tool call 之间用户跑 oauth 的话，会被错认为初始 baseline，hook 不 fire。

- **P2 — cookie rotation 不 hot-reload**：server.js 现注册 `onCookieChange` hook 把 userClient 设 null。Pre-fix monitor detect LARK_COOKIE 变化但 server.js 没 hook，rotation 后 cookie-based 工具 (send_to_user / search_contacts / get_login_status / send_as_user / batch_send) 继续用 stale cookie 直到重启。

- **read_messages via_user=true 错标 via='bot'**：`readMessagesWithFallback` 的 skipBot 分支默认 `via='bot'`，Path B (cookie 解析) 标 `via='contacts'` + reason='contacts_resolved_external'。via_user=true 显式调用混进了 contacts_resolved_external reason。Fix：handler 显式 pass `via: 'user'`；readMessagesWithFallback skipBot 分支按 `via === 'contacts'` 显式判断。

### Changed

- **observability — _populateSenderNames 加 unresolved id log**：getUserById / getAppName 失败时 return null 而 **不** reject，原 Promise.allSettled rejection log 漏掉这种 case。现在每个 batch 后单独 log 未解析 ids: `sender name unresolved (cached null) for N id(s): ou_xxx, ...`（与 v1.3.12 的 negative-cache sentinel 配合）。

### CI / Process

- **validate.yml 加 `npm test` + `check-changelog.js`**：之前 14 个 fixture-based unit tests 不在 PR gate 里，任何破坏它们的 PR 都能进 main；CHANGELOG section 缺失也不挡。现在两者都是 PR check 的一部分。
- **test-lark-desktop.js 接入 npm test**：原是孤儿 standalone script，现在 export run() 被 test-all.js require。

### Docs

- CLAUDE.md 删除 stale "未实现:search_messages"（v1.3.12 已实装），换成"已删除"段（md ↔ wiki 双向同步 + Mermaid → 画板 都已删）。
- CLAUDE.md 工具大类计数 reconcile 到 85：Drive 5 → 4，加 "跨域 Uploads (3)" 行，"插件层 4" → "多 profile 3" + 实时事件 2。
- docs/REFACTOR-NOTES.md tools/ 子树补 tasks.js + events.js（v1.3.7 / v1.3.9 加但 doc 一直漏）；smoke 契约 "当前 84" → "当前 85"；events/ 子树第 layout 段已在 v1.3.12 加入。
- docs/TOOLS.md IM section 工具列表补 `search_messages`；Drive section 拆成 Drive 4 + Uploads 3 跟实际 src/tools/ 一致。
- docs/COMPARISON.md / CONTRIBUTING.md / .github/pull_request_template.md：84 → 85；COMPARISON.md "本仓：最新 v1.3.11" → v1.3.12。

### 其他 polish

- docs/CLIENT-COMPAT.md（v1.3.12 加的）：标题 "5 客户端" → "7 客户端"；Tools 列 ✓ 84 → ✓ 85；`feishu-user-plugin-1.3.11.mcpb` 改成 version-agnostic placeholder。
- scripts/verify-app-name.js：错误 URL 插入实际 appId（之前是 `<appId>` 字面）。
- src/test-lru-cache.js：fix stale header 引用 `src/utils/lru-cache.js` → `src/utils.js`。

### Test scenarios

- `npm test`：14 个 fixture-based test 全 pass（包含 v1.3.13 加的 `test-lark-desktop` wiring + identity-state `_viaUser=true` 断言）
- `node scripts/verify-app-name.js`：当前 APP self_manage scope 已开 → 输出 `OK — app name resolves to "Claude聊天助手"`；错误路径打印的修复 URL 含实际 cli_xxx appId
- 重启 Claude Code / Codex 后跑任何 UAT-owned 写工具（如 `create_doc` / `create_bitable` / `create_calendar_event` / `update_task`）→ 响应里 `viaUser:true`（而非 v1.3.12 的 `viaUser:false`）
- 跑 `npx feishu-user-plugin oauth` 后**不重启**，下次 `get_login_status` 立即 Valid（hot-reload 启动期空窗已修）
- 改 credentials.json 里的 LARK_COOKIE 字段后**不重启**，下次 cookie 工具如 `send_to_user` 会用新 cookie（onCookieChange hook 已注册）

## [1.3.12] - 2026-05-15

主线：4 个 architectural root cause（A scope drift / B silent fallback / C LLM-unfriendly 数据 / D hot-reload 缺失）一次性收口 + 1 个新工具 `search_messages`（B.5 Protobuf 阶段二）+ CLI 工具模式（`tool` 子命令，复用 85 工具）+ SEO 改造（README h1 + repo description + 4 GitHub topics）+ 5 项工程质量（gitleaks 防 secret 误提交 / CHANGELOG 回填 v1.3.0-v1.3.2 / 客户端兼容矩阵 / 战略性微调 ×2）。工具数 84 → 85。

### Added

- **`search_messages` 工具（v1.3.12 B.5, UAT-only）**：包 `POST /open-apis/search/v2/message`。Probe 2026-05-15 确认飞书暴露该 endpoint，需 OAuth scope `search:message`（同期加入 `src/oauth.js` SCOPES + `docs/AUTH-SETUP.md` 表）。Filter 支持 `chat_ids` / `from_ids` / `at_user_ids` / `message_types` / `from_types` + 分页。返回 `{items, pageToken, hasMore}` 的 message-id 指针（不是 full bodies）—— 跨多群搜索时 response token 友好；caller 再调 `read_messages(chat_id)` 拿 full content。99991679 error 给明确 scope 指引（"re-run npx feishu-user-plugin oauth"）。
- **CLI 工具模式 `npx feishu-user-plugin tool …`（v1.3.12 形态扩展）**：复用 `src/server.js` HANDLERS + 新 export 的 `buildCtx()`，CLI 跟 MCP 走同一代码同一 ctx 装配。3 个子命令：`tool list`（列 85 工具名）/ `tool help <name>`（schema + description）/ `tool <name> '<json-args>'`（dispatch + 输出 response text 到 stdout）。新 `docs/CLI.md` 文档（用法 / cron / pipeline / 已知限制）。`src/logger.js` stdout guard 从 module-load side-effect 改成 opt-in `installStdoutGuard()`，CLI 模式不调它 → 结构化输出走真 stdout 供 `jq` / shell pipe 用；MCP server 模式（`src/index.js`）依旧首行调用 guard。
- **IdentityState 状态机 + `withIdentityFallback`（v1.3.12 root cause B）**：新模块 `src/auth/identity-state.js` —— 6 态枚举（VALID_USER / UAT_EXPIRED / UAT_REVOKED / UAT_MISSING_SCOPE / BOT_ONLY / NO_CREDENTIALS）+ `resolveIdentity(client)` 30s cache + `withIdentityFallback({client, uatFn, botFn, label})` 返回 `{data, via, viaReason, identity, fallbackWarning}`。`asUserOrApp` 内部 routes 过去；外部 shape 完全不变（`_viaUser` / `_fallbackWarning` / `.uatSummary` / `.appError` alias 都保留），15+ callsite 在 calendar / docs / bitable / wiki / okr / tasks / drive / im 无感升级。失败时 UAT 端返回 20064 → `UAT_REVOKED`、99991668 → `UAT_MISSING_SCOPE`、99991663 → `UAT_EXPIRED`，bot 端 fallback 时给 LLM 一行明确的 `viaReason` 而非静默吞错。
- **CredentialsMonitor hot-reload（v1.3.12 root cause D）**：新模块 `src/auth/credentials-monitor.js` —— factory `createCredentialsMonitor({path?})`，每个 tool-call entry 跑 `sync()`，stat mtime + 对 active profile 的 UAT / refresh / cookie 字段 hash 比对。Diff 触发 4 hook 之一：`onUatChange(env)` reload `officialClient._uat/_uatRefresh/_uatExpires` + invalidate identity cache；`onCookieChange(env)`（暂 no-op，userClient 下次自然 re-init）；`onProfileSwitch({from,to,env})` flip in-memory `currentProfile` + null client + clear resolver wiki cache；`onCacheInvalidate(env)` 清 identity-state cache。取代了 v1.3.9 的 `_syncActiveProfileFromDisk`（只看 active 字段）+ 取代了"重启 Claude Code 才能 reload UAT"的人工补救。`switch_profile` handler 改调 `credMonitor.sync()` 让 cross-process 同步走统一 baseline。
- **LRUCache 跨切面 helper（v1.3.12 root cause D 配套）**：`src/utils.js` 新 class，max + ttlMs（默认 500 / 10 min）。完整 Map-shaped API：`set`/`get`/`has`/`delete`/`clear` + `Symbol.iterator` + `entries`/`keys`/`values` generators（自动跳过 expired）。替代 `_userNameCache` / `_appNameCache` 之前的 unbounded `new Map()`。Negative-cache sentinel（v1.3.12 self-review followup）：失败 lookup 写 null sentinel 防止下次 read_messages 重发 N 个 API 调用。
- **PID liveness check for ws-owner lock（v1.3.12 root cause D 配套）**：`src/events/lockfile.js::acquireLongLived` 在 mtime fresh 时也读 body pid + `process.kill(pid, 0)`：ESRCH 立即 steal（之前要等 60s mtime 超时）。`src/events/owner.js::readOwnerInfo` 综合 `alive = mtimeFresh && pidAlive` —— SIGKILL'd owner 的 lock 在下个 30s takeover poll 就被回收。malformed body / 缺 pid 字段 fall back to mtime-only check（向后兼容）。
- **scope drift CI guard（v1.3.12 root cause A）**：`scripts/check-scopes.js` 从 `src/oauth.js` SCOPES 提 token list + 跟 `docs/AUTH-SETUP.md` 校对每条 scope 都 mentioned + banlist 已知错名（`calendar:calendar.event:write` / `okr:okr.content:write`）。修正 4 个 calendar scope（write → create / update / delete / reply）+ okr write → writeonly + 加 `im:resource` / `contact:contact.base:readonly` / `search:message`。完整 30 OAuth + 1 tenant-only 表落地 `docs/AUTH-SETUP.md`。CI `.github/workflows/validate.yml` 每个 PR 跑 check-scopes。
- **`displayLabel` + sender semantics pack（v1.3.12 root cause C）**：`read_messages` / `read_p2p_messages` 每条消息新增 `displayLabel`（如 `周宇` / `[Bot] Claude聊天助手` / `[Bot] (cli_xxx)` / `[匿名]` / `[系统]` / `[已撤回] 怪兽`）+ `senderIdType` / `senderTenantKey` / `isExternal` / `isRecalled` / `isThreadReply`。merge_forward children 加 `forwardedFromChatName`（im.js best-effort getChatInfo on each `originChatId`）。`_populateSenderNames` 新 Step 0 mention-name harvest（零 API 成本）+ Step 1 lazy self tenant_key resolve + Step 4 fill new fields。新 method `getAppName(cli_xxx)` 用 tenant-side `application:application:self_manage` scope 解析 bot 显示名（免审 scope，自助开通）。
- **gitleaks 防 cookie 误提交**：`.gitleaks.toml` 4 rules（`LARK_APP_SECRET` / `LARK_COOKIE` / `LARK_USER_ACCESS_TOKEN` / `LARK_USER_REFRESH_TOKEN`）+ allowlist 文档示例 / 测试 fixture。`.husky/pre-commit` 装了就跑（macOS `brew install gitleaks`），CI 工作流自 curl install gitleaks v8.30.1 binary。verified clean across 266 commits / 3.76 MB。
- **client compat matrix `docs/CLIENT-COMPAT.md`**：7 个 MCP 客户端 × 9 prompts × 85 tools 兼容表 + 已知 client-specific caveat（Codex 不支持 Claude Code skill；VS Code key 是 `servers` 不是 `mcpServers`；Cursor / Windsurf prompt UI 还在迭代等）+ 3 步复测 procedure（`/status` + `/send` + `list_chats`）。
- **`docs/ARCHITECTURE-NOTES.md` reference 永久化**：B / D 设计文档（5 态枚举 / 30s cache / 4 hook registry）作为实施 reference 永久保留 + 给未来类似 root cause 留 reusable pattern。14 根因清单全表 ⏸→✅。
- **CHANGELOG v1.3.0 / v1.3.1 / v1.3.2 entries 回填**：从 `git log --format='%H %ci %s' v1.3.0..v1.3.2` + tag commit body 重建 3 个 entry，跟 v1.3.6+ 同结构。CHANGELOG 现在从 v1.3.0 起连续。

### Changed

- **`send_*_as_user` 8 工具统一返回 shape**：`{ok, viaUser, description?, status?, messageId?, fallbackWarning?}`（pre-v1.3.12 是 plain text "Text sent as user to oc_xxx"，LLM / 脚本要 regex）。`sendResult` 接受 options form `sendResult(r, {desc, viaUser, fallbackWarning})`，back-compat 旧 `sendResult(r, descString)`。`send_card_as_user` 标 `viaUser: false`（cookie 不发卡片，仅 bot）。
- **`read_messages` 加 `via_user: boolean`**：`true` skip bot 直接 UAT；`false` skip UAT fallback bot-only（之前没此选项）；undefined = 现有 auto-fallback。`readMessagesWithFallback` 加 `skipUat` 配套（与 `skipBot` 互斥）。Path B (cookie search_contacts 解析) 在 `via_user=false` 时短路报错而非继续走 UAT。
- **`withUAT` retry 集合扩展**：在 `classifyError(thrown).action === 'retry'` 时一次性重试（同 UAT），coverage 涵盖 ECONNRESET / fetch timeout / JSON parse error。原 99991668 / 99991663 / 99991677 refresh-and-retry 路径不变。
- **FAILURE_MAP 扩展**：加 20064 (uat_revoked, symmetry-only — 真触发在 identity-state)、91403 (bot_cross_tenant)、1254000/1/301/400 (upload_transient)。TRANSIENT_PATTERNS 加 JSON parse error 识别，`classifyError` 输出独立 reason `response_parse_error` 让监控可区分。
- **`_userNameCache` / `_appNameCache` Map → LRUCache**：500 / 10min（用户）+ 100 / 10min（app）。原 unbounded Map 在长跑 server 上无限增长 + 永不过期，rename 的用户名字一周后还显示旧的。
- **README h1 + repo description + GitHub topics 加 cli/mcp**：h1 「飞书 MCP 服务器 + CLI 工具」+ description 加"CLI tool" + topics 加 `cli` / `feishu-cli` / `mcp-server` / `feishu-mcp`。
- **工具数 84 → 85**：仅加 `search_messages`，其他都是已有 schema 改 description / field（不算 schema 新增）。

### Fixed

- **`Promise.allSettled` 不读 status 导致 sender 解析失败被静默吞**（root cause #8）：`_populateSenderNames` 现读每个 result.status，rejected ids 进 stderr `[feishu-user-plugin] sender name lookup failed for N/M ids: ou_xxx(<reason>)...`。同一份 fix 同时对 user 路径 + app 路径生效。
- **解析失败的 sender id 不 cache 导致下次 read_messages 重复 API call**（pre-existing perf bug, v1.3.12 self-review followup）：`_populateSenderNames` 在每个 Promise.allSettled 后给未解析的 id 写 null sentinel。同 LRU TTL 10 min 给 rename 的 sender 一个 re-resolve 窗口。
- **oauth.js race condition (PR #45 P2)**：`saveToken` 在 OAuth callback 时不再重读 `getActiveProfileName()`，而是用 module-init 时 captured 的 `RESOLVED_PROFILE`。原 race：OAuth 期间另一进程 `switch_profile` 切了 active，token 会写错 profile。
- **`oauth.js::getAppInfo` silent catch 99991672**：原 `try {...} catch {}` 完全不报；改成 stderr warn 指明缺 tenant-side `application:application:self_manage` scope + 影响 `displayLabel`。新 `scripts/verify-app-name.js` 一次性诊断脚本可手动验证 scope 已开（exit 0 / 1 / 2 三种状态）。
- **server.js `onUatChange` 直接裸写 client 内部字段**（v1.3.12 self-review followup）：改调 `loadUATFromEnv(officialClient, env)` helper（已存在，statup 用同一个）。`loadUATFromEnv` 扩展为支持 clear-on-empty（env 无 token → 主动 nil 内存里的 stale token）。
- **`LRUCache` 缺 `Symbol.iterator`**（v1.3.12 self-review followup）：原注释说 "API-compatible with the old Map" 但 spread / for-of 会 TypeError。加 iterator + entries/keys/values generators（自动跳过 expired）。

### Test scenarios

- 重启后跑 `read_messages` 看每条消息有 `displayLabel` + bot 消息形如 `[Bot] Claude聊天助手`（非 cli_xxx）+ recall 消息有 `[已撤回] ` 前缀 + cross-tenant 有 `isExternal: true`
- 跑 `npx feishu-user-plugin oauth`，**不重启**，下次 `get_login_status` UAT 应立即 Valid（D2 CredentialsMonitor onUatChange hook 工作）
- 在 Lark Desktop / shell 操作让 multiple MCP server 进程并发 → 它们的 in-memory UAT 通过 credentials.json 自动同步（D2 + B identity refine）
- 模拟 SIGKILL'd MCP server（kill -9 持有 ws-owner.lock 的进程）→ 另一进程在 30s 内 takeover（D4 PID liveness check）
- `gitleaks detect --config .gitleaks.toml`：跑过 266 commits / 3.76 MB，0 leaks
- `npx feishu-user-plugin tool list`：返回 85 tool names exit 0
- `npx feishu-user-plugin tool get_login_status '{}'`：返回 status 文本到 stdout
- `npx feishu-user-plugin tool search_messages '{"query":"周报"}'`：需 user 先 `npx oauth` 拿 `search:message` scope；之后 dispatch 该 endpoint 返回 items
- `node scripts/verify-app-name.js` 当前 APP 已开 self_manage scope → 输出 `OK — app name resolves to "Claude聊天助手"`
- `node src/test-all.js` 跑 19 个 fixture-based unit test 全 pass（含 v1.3.12 新加的 9 个：test-error-codes / test-identity-state / test-with-uat-retry / test-populate-sender-names / test-credentials-monitor / test-lru-cache / test-lockfile-pid / test-negative-cache / test-send-shape / test-via-user / test-search-messages / test-cli-tool）

## [1.3.11] - 2026-05-09

主线：Lark Desktop 多账号无感切换 — 在 Feishu Desktop 切账号，MCP 在 ~15 s 内自动跟到对应 profile。同期完成三项上架基建：MCP Registry CI 自动 publish 在 v1.3.11 头号 release 已自动跑通（`registry.modelcontextprotocol.io` 现 isLatest=1.3.11）；Anthropic `.mcpb` 包 + `PRIVACY.md` 与 Cursor `.cursor-plugin/plugin.json` 仓库材料就绪、已上 npm，剩余只待用户去外部平台填表单。工具数 84 不变。

### Added
- **Lark Desktop 多账号无感切换 (A)**：用户在 Feishu Desktop 切换账号 → MCP 自动跟到对应 profile，零 CLI 命令、零工具调用。`credentials.json::profiles[*].larkHash` 字段绑 profile ↔ Lark `~/Library/.../sdk_storage/<hash>/`；owner heartbeat (15 s) `stat cookie_store.db` mtime，最近活跃 hash 与当前 active 不一致 + mtime 推进时调 `setActiveProfile`（5 s debounce）。`setup` 在 `fresh` / `update` 模式下自动绑定（单账号直接绑、多账号在交互模式下用户选 / 非交互取最近活跃 + 在 stderr 列出其它），新 flag `--bind-hash <hex>` 显式绑定 / `--no-bind-hash` 跳过。未绑定但活跃的 hash 在 stderr 打一次性提示带 `setup --profile <name> --bind-hash <hash>` 命令。Lark 加密 `cookie_store.db` 全程不读不解密；cookie 仍由 `LARK_COOKIE` 按 profile 单独提供。macOS-only；Linux / Windows 默认 no-op。新模块 `src/auth/lark-desktop.js`（`getSdkStorageDir` / `listAccountHashes` / `mostRecentHash` / `detectSwitch`）+ `credentials.js` 新 API（`getProfileLarkHash` / `setProfileLarkHash` / `findProfileByHash`）+ `server.js` heartbeat 反应器接入；13 个 fixture-based 单元测试 `src/test-lark-desktop.js` 不依赖真 Lark Desktop 安装即可跑。
- **`.mcpb` 桌面扩展打包 + `PRIVACY.md`**：仓库具备 Anthropic Connectors Directory 收录所需所有材料；`node scripts/build-mcpb.js` 产出 `dist/feishu-user-plugin-1.3.11.mcpb`（250 KB），可上传 https://clau.de/desktop-extention-submission（剩余待用户填表单，ROADMAP `v1.3.12 / 上架提交`）。`.mcpb/manifest.json` 走 `manifest_version=0.3` schema（顶层 `server.mcp_config` + `user_config` 块声明 5 个 `LARK_*` 全 `sensitive=true`，Claude Desktop UI 自动提示用户填凭证后通过 `${user_config.KEY}` 替换到 `mcp_config.env`）；`PRIVACY.md` 中英双语 6 维度（采集 / 处理 / 存储 / 第三方 / 留存 / 联系），README 加 "## 隐私 / Privacy" 段；CI gate `scripts/check-mcpb-version.js` 接进 `validate.yml` 校验 `.mcpb/manifest.json::version` 与 `package.json::version` 一致。
- **`.cursor-plugin/plugin.json` + 4 源版本三角**：仓库具备 Cursor Marketplace 收录所需 manifest（`mcpServers` 块镜像 README 的 Claude Code 配置），可去 https://cursor.com/marketplace/publish 提交（剩余待用户填表单，ROADMAP `v1.3.12 / 上架提交`）。校对 `cursor/plugins` 官方 schema 修正 prep 文档错误：`author` 实际是 `{name, email}` with `additionalProperties: false`（非 `{name, url}`），`repository` 是字符串（非 `{type, url}`）。`scripts/check-version.js` 由 3 源扩 4 源版本三角（`package.json` / `.claude-plugin/plugin.json` / `SKILL.md` / `.cursor-plugin/plugin.json`），任一源 mismatch 即 CI fail。
- **MCP Registry CI 自动 publish**：`v1.3.11` 头号 release 已自动跑通——`registry.modelcontextprotocol.io` 现 isLatest=1.3.11；以后每次 tag 推送自动同步，零人工。`.github/workflows/publish.yml` 增 mcp-publisher 步骤（curl 安装 `mcp-publisher` 二进制 → `login github-oidc`，runner OIDC token 取代 PAT → `publish mcp-registry.json`），publish job 加 `permissions: id-token: write`。`scripts/check-mcp-registry-version.js` 在 `publish.yml`（pre-publish）+ `validate.yml`（PR-time）双闸门校验 `mcp-registry.json::version` + `packages[0].version` 与 `package.json::version` 一致。

### Test scenarios
- 单 profile + 单 hash：`setup` 自动绑定，stderr 一行 `Bound profile "default" to Lark account hash <hex>`，无后续噪声
- 多 profile + 多 hash：在 Lark Desktop 切到 profile B 绑的账号 → 15 s 内 stderr 出 `Lark Desktop account changed; switching profile to "B"` → `credentials.json::active` 更新 → 下一次工具调用走 B 的凭证
- 未绑定但活跃 hash：在 Lark Desktop 切到一个新账号 → stderr 出一次性提示带 `setup --profile <name> --bind-hash <hash>` 命令；后续 heartbeat 不再重复
- 非 darwin：`getSdkStorageDir()` 返回 null，反应器全部 no-op；`setup --no-bind-hash` 显式跳过
- `node scripts/build-mcpb.js` 产出 `dist/feishu-user-plugin-1.3.11.mcpb`，`unzip -p` 验证 `manifest.json` 在 archive 根
- `curl 'https://registry.modelcontextprotocol.io/v0/servers?search=feishu-user-plugin'` 返回 v1.3.11 isLatest=true

## [1.3.10] - 2026-05-09

Growth track 一次性 ship + Official MCP Registry 上架。本版无新工具（84 不变），主体是发现入口、文档语气与发布元数据：仓库一句话描述与 npm description 同步、GitHub Pages 中文优先 SEO landing 上线、`README.md` 主版本切到中文、`docs/launch/` 13 文件 launch 草稿就位、Dockerfile 给 Glama listing introspection 用、自定义 OG image 替代 GitHub 默认渲染、CONTRIBUTING.md 双语重写。所有用户可见文档统一去除 reverse-engineering / 暴力探测 / 营销腔 / 合规免责段。

### Added
- **Official MCP Registry 上架**：仓库根 `mcp-registry.json` 是 registry 元数据契约（schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`），`packages[].registryType=npm` + `transport.type=stdio` + 5 个 LARK_* 环境变量声明。`package.json::mcpName=io.github.EthanQC/feishu-user-plugin` 提供命名空间归属，与现有 OpenClaw 格式 `server.json` 并行不冲突。v1.3.10 起包同步推到 `registry.modelcontextprotocol.io/v0/servers/io.github.EthanQC/feishu-user-plugin`，下游 Smithery / mcp.run / LobeHub 自动拉取。
- **Dockerfile + .dockerignore**：仓库根 `node:20-alpine` + `npm ci --omit=dev`，`CMD ["node", "src/index.js"]` 走 stdio。Glama 等需 Docker introspection 的 marketplace 检查可直接跑（MCP server 启动不需要 LARK_* env，工具调用时才校验，所以 introspection 不需要凭证）。
- **GitHub Pages 中文优先 SEO landing**：`https://ethanqc.github.io/feishu-user-plugin/`（中文）+ `/en.html`（英文）。jekyll-cayman + jekyll-seo-tag + jekyll-sitemap，源在 `docs/`；`docs/_config.yml` exclude 内部 dev 文档（REFACTOR-NOTES、TESTING-METHODOLOGY、CREDENTIALS-FORMAT、COOKIE-PROTOBUF-CAPTURES、superpowers/）保持 SEO 信号集中。仓库 Homepage URL 指向 Pages。
- **OG image 1200×630（中文 stat 卡）**：`docs/og.png`（rendered from `docs/og.svg`）+ `scripts/generate-og-image.js`（@resvg/resvg-js + 系统 PingFang SC 字体）。jekyll-seo-tag defaults 引用 + `twitter:card=summary_large_image`，社交分享卡替代 GitHub 默认渲染。
- **`docs/launch/` 13 文件 launch material**：MCP 收录（awesome-mcp-servers 提交模板 / mcp-registry 提交步骤 / Anthropic Connectors 与 Cursor Marketplace 推迟到 v1.4 的阻塞清单）+ 中文长稿（掘金 3 实战场景 / 知乎专栏首篇 / 知乎答题目标清单）+ 平台短稿（V2EX 周五帖 / 飞书开放平台社区贴 / HelloGitHub 月刊自荐 / 阮一峰 weekly issue）+ 英文 X long thread。所有 drafts，等用户 dispatch。
- **CONTRIBUTING.md 双语重写**：post-v1.3.7 layout（`src/clients/official/<domain>.js` + `src/tools/<domain>.js` + `_registry.js` ctx 契约）+ 4 个 pre-commit gate（CLAUDE.md sync / 三角等价 / 工具数徽章 / smoke）+ commit 前缀 + 9 步新增工具流程。中文优先，英文并列段。
- **GitHub Discussions 启用**：作为社群运营 + 维护信号渠道，`announcements` / `Q&A` / `show-and-tell` 默认 categories。
- **4 个 good-first-issue**（#61-#64）：CHANGELOG 历史回填 v1.3.0-v1.3.5；`README.en.md` section header 工具数对齐到 84；`read_doc_markdown` 测试覆盖；Cursor / Windsurf / OpenClaw 9 prompt 兼容矩阵。
- **`.github/pull_request_template.md` 更新**：丢弃过时的 `test-send.js` / `test-all.js` checklist，换成 4 个真实 gate（smoke / 三角等价 / CLAUDE.md sync / 依赖审）。

### Changed
- **README 主版本切到中文**：`README.md` 中文优先，`README.en.md` 是英文镜像；旧 `README_CN.md`（v1.3.4 起停滞，工具数仍写 74）删除。`package.json::files` 加 `README.en.md` 让 npm tarball 同时含两份。
- **About description 中文化**：GitHub repo 一句话描述从 "Feishu MCP Server using reverse-engineered protocol for user-identity messaging (not bot)" 换成中文版（"飞书 MCP 服务器：让 Claude Code 与 Codex 直接接管你的飞书工作流..."）；npm description 走 `package.json` 英文版（"All-in-one Feishu MCP server for Claude Code & Codex — 84 tools across 3 auth layers..."）保持国际可见度。
- **topics 删 `reverse-engineering`**：标签 9 → 8（claude / claude-code / feishu / im / lark / mcp / messaging / protobuf）。
- **README + Pages + docs/launch/ 全部去 reverse-engineering / 暴力探测 / brute-force 框架**：用户可见文档统一改为 plain technical 语气，不再把 cookie + protobuf 协议路径写成"反向工程 / 暴力探测"。`send-as-user` 仍是核心差异化锚点，描述为"基于 cookie + protobuf 协议路径"。
- **删 ToS / 合规免责段**：README 与 Pages landing 顶部"个人 / 内部用途, 非商业 SaaS"段全部移除（用户判定为 performative，LICENSE + 技术现实已足够）。
- **`docs/launch/awesome-mcp-servers-pr.md` 增补 Glama listing 要求**：Glama bot 在 PR #6090 用 `missing-glama` label 标记并要求提交到 `glama.ai/mcp/servers` + 加 score badge。entry line 模板更新为含 Glama badge 版本（待 Glama listing 通过后才渲染分数）。
- **`docs/launch/mcp-registry-submission.md` 改为 agent-driven 版本**：从"用户跑 mcp-publisher CLI"换成"agent 装好 + 用 `gh auth token` 直连 login + publish"，仅 GitHub OAuth 一次点击在用户侧（v1.3.10 ship 完后用 `github-oidc` 模式接进 GitHub Actions release workflow，CI 全自动）。

### Removed
- **`README_CN.md`（5 个版本 stale）**：内容由新主版本 `README.md` 取代。
- **demo 终端截图与生成脚本**：`docs/demo-send-as-user.{svg,png}` + `scripts/generate-demo-image.js` 全部移除（用户判定 README 不需要静态截图，OG image 已覆盖社交分享场景）。
- **README 顶部 ToS / 合规免责段**：移除（详见 Changed 段）。

### Deferred to v1.3.11
- **A. Lark Desktop 多账号联动**（v1.3.10 原计划主线，平移到 v1.3.11）：用户在 Feishu Desktop 切账号 → MCP 自动跟进。schema 扩展 + setup CLI 自动检测 + owner heartbeat stat sdk_storage mtime + 未绑定 hash 的处理路径。预计 1-1.5 天单独 PR。
- **C. 本地 md → 飞书知识库同步**（v1.3.4 起持续推迟）：md parser 选型、`src/doc-blocks.js` 构造器补齐、wikilink 三级解析、图片 / 文件 inline、CLI 子命令 vs MCP 工具取舍、增量 diff 策略。
- **B.5 `search_messages`**：先试 UAT `/open-apis/im/v1/messages/search`，不暴露则尝试 cookie 路径。
- **E. `src/config/` 目录化拆分**（条件触发）。
- **G. OpenClaw 偏好文件**。

### 已调研但暂不实施
- **Anthropic Connectors Directory**：需 `.mcpb` 打包 + `manifest.json::privacy_policies` + README "Privacy Policy" 段；缺一项即被拒。规划 v1.4 任务，详见 `docs/launch/anthropic-directory-prep.md`。
- **Cursor Marketplace**：需 `.cursor-plugin/plugin.json` manifest。规划 v1.4，详见 `docs/launch/cursor-marketplace-prep.md`。
- **Windsurf MCP Marketplace**：无公开第三方提交渠道（仅官方 partnership 邀请）。靠 Official MCP Registry 同步覆盖。
- **百度站长 / Google Search Console 主动提交**：用户决定靠自然爬取 + 反链。`docs/sitemap.xml` 与 `docs/robots.txt` 已就位作为被动准备，未来想提交时直接 paste-and-go。

### Test scenarios
- 验证 `npm view feishu-user-plugin version` 返回 `1.3.10`
- `mcp-publisher publish mcp-registry.json` 推到 registry，`curl https://registry.modelcontextprotocol.io/v0/servers/io.github.EthanQC/feishu-user-plugin` 返回 v1.3.10 元数据
- GitHub Pages https://ethanqc.github.io/feishu-user-plugin/ 与 `/en.html` 都返回 200，`<head>` 含 `og:image` 指向 `docs/og.png`
- `docs/sitemap.xml` 由 jekyll-sitemap 自动生成，含 index + en 两个 URL
- punkpeye/awesome-mcp-servers PR #6090 entry 带 Glama badge（待用户在 Glama 完成 listing 后渲染分数）
- 所有用户可见文档（README / README.en / docs/index / docs/en / docs/launch/*）均不再含 "反向工程" / "reverse engineering" / "暴力探测" / "brute-force" 字样

## [1.3.9] - 2026-05-08

D 系列首项 ship：新增 `read_doc_markdown` 工具，用 `feishu-docx` 把 docx blocks 转换为 markdown 字符串输出，替代 `get_doc_blocks` 的结构化 JSON，给 RAG / digest / 摘要类调用省 ~60% token（实测 216 KB JSON vs 90 KB markdown）。A 系列主线 ship：WS 机器级 SSOT + active profile 跨进程同步 + setup CLI 4 行决策矩阵 + per-profile events 字段。工具数 83 → 84。

### Added
- **`manage_ws_status(action=info|reconnect|claim|rotate|reconfig)` (A.1)**：5-action 工具，`info` 给 owner / WS / log / cursor / config 状态 dump；`reconnect` / `rotate` / `reconfig` 是 owner-only；`claim` 接管 stale lock，`force=true` 强夺活跃 owner。`rotate` 触发 `events.jsonl` → `events.jsonl.old` 轮转。`reconfig` 重读 `credentials.json::profiles[active].events` 并重新注册事件类型，无需重启。
- **WS 机器级 SSOT (A.1)**：单 owner 进程持 `~/.feishu-user-plugin/ws-owner.lock`（O_CREAT|O_EXCL，30 s stale），事件写 `events.jsonl`（append-only，10 MB soft / 20 MB hard cap，超限 rotate 成 `.old`），全局共享 `events.cursor.json` 保护以 cursor-specific lock 避免并发 drain 重读。多 harness 同事件不再重复；owner 死亡 / 锁过期后下一个 MCP 进程自动接管，event log 不丢。
- **Active profile 跨进程同步 (A.2)**：dispatcher 入口 stat `credentials.json` mtime；变化时重新读 `active`，与 in-memory `currentProfile` 不同即触发 `setActiveProfile`（invalidate `userClient` / `officialClient` 缓存）。成本 ~10μs/call（macOS stat）。`FEISHU_PLUGIN_PROFILE` env 退化为 bootstrap-only；`credentials.json::active` 为唯一跨进程权威来源。
- **setup CLI 4 行决策矩阵 (A.3)**：非交互模式自动判断 `fresh` / `auto-migrate` / `preserve` / `update` 四种路径；新增 `--force` flag 强制重写 + `--profile <name>` 指定目标 profile。`credentials.json` 已存在时默认 `--pointer-only`；首次安装自动 migrate，harness env 只写 `FEISHU_PLUGIN_PROFILE=default`，消除多 harness token diverge。
- **per-profile events 字段 (A.4)**：`credentials.json::profiles[*].events` 可选数组，缺省 `["im.message.receive_v1"]`；支持 `approval.instance.created_v4` / `calendar.calendar.event.changed_v4` 等。编辑后调 `manage_ws_status(action=reconfig)` 立即生效，不需重启。`FEISHU_PLUGIN_EXTRA_EVENTS` env 仅在首次 bootstrap 时写入，不覆盖已有字段。
- **`read_doc_markdown(document_id)` (D)**：返回 markdown 字符串而非结构化 JSON，省 ~60% token；依赖 `feishu-docx@^0.7.0`，后处理器 `_normaliseEmbeds` 位于 `src/tools/docs.js`。嵌入图片 / 文件以 `feishu://image_token/<TOKEN>` / `feishu://file_token/<TOKEN>` 占位符形式保留，配合 `download_doc_image` 取二进制内容。`document_id` 同样接受原生 token / wiki node token / 飞书 URL，分辨率逻辑与其它 doc 工具相同。

### Fixed
- **`send_image_as_user` 不再报 HTTP 400 (B.1)**：v1.3.9 通过暴力探测 cookie protobuf gateway 拿到 IMAGE 最小有效字段集 — `Content.imageKey` (字段 2) + `Content.thumbnailKey` (字段 10) 即可发送成功；宽 / 高 / mime / size 全部可选。`proto/lark.proto` 加了 `imageWidth=4 / imageHeight=5 / mimeType=8 / fileSize=9 / thumbnailKey=10` 五个字段；`sendImage()` 默认 thumbnailKey = imageKey（飞书在缩略图未单独上传时接受同 key）。`scripts/explore-image-minimize.js` 留作未来字段验证起点。

### Removed
- **`send_card_as_user(via="user")` 路径删除 (B.4)** — v1.3.9 通过 brute-force 确认 cookie protobuf gateway 的 `cmd=5 type=14 (CARD)` 路径在服务端 auth 层就被拒绝（任何字段组合都返回同一句 `richText and card type need for card message`，验证发生在 Content 解析之前）。结论是用户身份发卡片在 Feishu cookie auth tier 被服务端禁用，brute-force 不可解。`send_card_as_user` 工具保留，但 `via` 参数和 `via="user"` 代码分支彻底移除，工具固定走 bot (Official API)。`as_user` 后缀作历史命名保留，避免破坏调用方。`scripts/explore-card-protobuf.js` 留作参考，下次会话不需要重复 brute-force。

### Test
- **`switch_profile` 多 profile e2e (F.1)**：验证原子 credentials.json 更新 + 进程内 cache 失效。位于 `src/test-switch-profile.js`，CI-friendly（dummy 凭证不联网）。

### Test scenarios
- 调用 `read_doc_markdown(<docx_token>)`，确认返回 markdown 字符串而非 JSON；HTML 标签如 `<b>` `<em>` 已被转成 `**` `*` 等价物
- 包含 mention 链接 `[doc](wikcnXXX)` 的文档应保留原样，不被错判为 file token 占位符
- 启动 MCP 看 stderr 是否出现 `WS connected (profile=default)`；`~/.feishu-user-plugin/ws-owner.lock` 应存在
- 多 MCP 进程同时跑 → 仅一个看 `WS connected`，其它静默 → `manage_ws_status(action=info)` 看 `is_owner` 字段

## [1.3.8] - 2026-05-05

本次更新主线是多 profile 自动切换和 WebSocket 实时事件两块新能力，同时把 v1.3.7 推迟的 auth 模块拆分和凭证 pointer-only 模式补齐，并加固 CI 闸门（server.json 自动重生、SKILL.md allowed-tools 与 TOOLS 1:1 校验、CHANGELOG section 校验、文档三方同步校验）。工具数 80 → 82。

### Added
- **多 profile 自动切换 (B)**：当 `~/.feishu-user-plugin/credentials.json` 配了 ≥2 profile，读取类工具（`read_*` / `list_*` / `get_*` / `search_*` / `download_*` 加 `manage_bitable_*` 的 read-action 变体）遇到 91403 / 1254301 / 1254000 / 99991672 / HTTP 403 时自动尝试其它 profile 重试。命中后 resourceKey → profile 写入 `profileHints`，下次直接走对的账号。写操作绝不自动切；显式 `via_profile="alt"` 单次锁定，`via_profile="auto"` 在写操作上手动允许。
- **新工具 manage_profile_hints**：`action=list|set|clear, resource_key?, profile?`，检查或编辑 profile 命中缓存。
- **WebSocket 实时事件 (C)**：MCP server 启动时后台连飞书 WSClient（仅 feishu.cn，Lark 国际版不支持），事件入 1000 容量 FIFO buffer。新工具 `get_new_events(event_type?, event_types?, chat_id?, since_seconds?, max_events=50, peek=false)` 拉取，默认 drain 语义；当前注册 `im.message.receive_v1`。
- **Cookie protobuf 工具链 (A.0)**：`scripts/decode-feishu-protobuf.js` 解码 + 报告未知字段；`scripts/capture-feishu-protobuf.js` 抓包 recipe；`docs/COOKIE-PROTOBUF-CAPTURES.md` 流程文档。下版本用这套真做 send_image / audio / sticker / card / search_messages 反向。
- **`FEISHU_PLUGIN_PROFILE` 启动 env (E.1)**：让 harness 各自指向不同 profile，启动时校验存在（拼错直接 exit 2，不静默 fall through）。
- **`setup --pointer-only` 模式 (E.2)**：harness env 只写 `FEISHU_PLUGIN_PROFILE=default`，真凭证全部留 `credentials.json`，消除 UAT 刷新后两端 diverge。

### Changed
- **`src/auth/uat.js` + `src/auth/cookie.js` 拆分 (D.1, D.2)**：从 `clients/official/base.js` 和 `clients/user.js` 拆出来，client 实例上变 1-line delegate；状态字段保留在客户端实例。base.js 减约 200 行，关掉 v1.3.7 Phase B 的拆分欠账。
- **启动诊断更主动 (E.3)**：credentials.json + 旧 LARK_* env 双存在打 NOTE 提示 env 已被忽略；env-only 用户打 TIP 建议运行 `npx feishu-user-plugin migrate --confirm`。

### Fixed
- **server.json 长期 drift**：长期停在 v1.2.0 / 33 tools 且包含已删工具。新增 `scripts/sync-server-json.js` 从 package.json + TOOLS 自动重生，prepublishOnly 与 CI 验证 drift；本版同步到 v1.3.8 / 82 tools。
- **`check-tool-count.js` 扩展**：除 README badge 之外同时校验 `SKILL.md::allowed-tools` 与 TOOLS 一致，避免 SKILL.md 单独 drift 漏掉。
- **G.1 wiki-attach 兜底回归脚本**：`scripts/test-wiki-attach-fallback.js` 把 `attachToWiki` monkey-patch 成抛 91403，验证 `upload_drive_file` 把失败透出来而不是默默上传到 drive root。POSIX skip 77 缺凭证时跳过。

### Deferred to v1.3.9
- Cookie protobuf 实际抓包：`send_image_as_user` / `send_audio_as_user` / `send_sticker_as_user` / `send_card_as_user` 真用户身份 / `search_messages`。工具链已 ship（`scripts/decode-feishu-protobuf.js` 等），抓包 session 留下版本一并做。
- 机器级 SSOT 完整化：WebSocket 单 owner + 共享 events.jsonl + 单一 drain 游标；active profile 跨进程 stat 同步；setup 非交互模式自动 pointer-only。
- 本地 md → 飞书 wiki 同步、`read_doc_markdown` 工具、`src/config/` 目录化拆分。
- `switch_profile` 多 profile e2e（mock 第二 profile 测 setActiveProfile cache 失效路径）。
- 测试群 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e` 解散（卡 group owner 权限转让）。

### Test scenarios
- 调用 `read_doc` 命中外部租户文档时观察 stderr 出现 `profile-router: default → alt on read_doc (code=91403)`，结果回到 alt profile 的内容
- 用 `send_to_user` 给自己发条文本后调 `get_new_events`，看到对应的 `im.message.receive_v1` 事件
- 跑 `npx feishu-user-plugin migrate --confirm` 后重启 MCP，启动 stderr 显示 `Auth: ... source: credentials.json profile=default`，所有工具调用照常

## [1.3.7] - 2026-05-04

### Added
- **Wiki write (5 tools)**: `create_wiki_node` / `update_wiki_node` / `move_wiki_node` / `copy_wiki_node` / `delete_wiki_node`. UAT-first. `create_wiki_node` builds doc/sheet/bitable/mindnote/file/docx/slides directly inside a wiki space, or `node_type=shortcut` for a pointer. `update_wiki_node` only patches `title` (Feishu wiki API doesn't accept content edits — those go through docx/bitable/sheet). `move`/`copy` accept `target_parent_token` + optional `target_space_id` for cross-space migration. `delete_wiki_node` calls `DELETE /wiki/v2/spaces/{id}/nodes/{token}` via raw REST (SDK doesn't type it) — only deletes the node pointer, not the underlying drive resource.
- **OKR progress writes (3 tools)**: `create_okr_progress_record` / `list_okr_progress_records` / `delete_okr_progress_record`. UAT-first. Requires `okr:okr.content:write` scope. `create` accepts a simplified `content_text` (auto-wrapped into Feishu's block schema) plus optional `source_title` / `source_url` / `progress_percent`. `list` extracts `{progress_id, target_id, target_type}` triples from `get_okrs` since Feishu has no native list endpoint.
- **Calendar write (5 tools)**: `create_calendar_event` / `update_calendar_event` / `delete_calendar_event` / `respond_calendar_event` / `get_freebusy`. UAT-first. Requires `calendar:calendar.event:write` scope. `start_time` / `end_time` are objects: `{timestamp:"<unix-seconds>", timezone?}` or `{date:"YYYY-MM-DD"}`. `delete` accepts `meeting_chat_id` to also dissolve the linked meeting chat. `respond` is the RSVP path.
- **Tasks v2 (7 tools, new domain)**: `list_tasks` / `get_task` / `create_task` / `update_task` / `complete_task` / `delete_task` / `manage_task_members`. UAT-first. Requires `task:task` scope. v2 uses `task_guid` instead of v1 numeric `task_id`. `update_task` requires explicit `update_fields=["summary","due","completed_at",...]` — Feishu only patches the listed fields. `complete_task(completed=true|false)` is a convenience wrapper.
- **MCP prompts (9)**: `/send` `/reply` `/digest` `/search` `/doc` `/table` `/wiki` `/drive` `/status`. Mirror the Claude Code skills via `prompts/list` + `prompts/get`, so Codex / Cursor / OpenClaw / Windsurf get the same guided UX. Reference bodies are read at server start from `skills/feishu-user-plugin/references/`.
- **Single-source credentials store**: `~/.feishu-user-plugin/credentials.json` (mode 0600, schema `docs/CREDENTIALS-FORMAT.md`). Multiple MCP processes (Claude Code + Codex sharing the file) see token rotations consistently — closes the "Codex still has the old UAT after a refresh in Claude Code" drift. Cookie heartbeat + UAT refresh persist back atomically. Opt-in: `npx feishu-user-plugin migrate` (dry-run) / `migrate --confirm` (writes). Env vars remain as backward-compat fallback. Server's `Auth:` startup line on stderr shows source (`credentials.json profile=default` vs `env vars (legacy)`).
- **Semi-automated regression**: `scripts/test-all-tools.js` walks every tool with representative payloads. `tests/baseline/` snapshots `tools-list.json` / `prompts-list.json` / `login-status-shape.json`; `npm run smoke` diffs against them, `npm run smoke:baseline` regenerates after intentional schema change. `docs/TESTING-METHODOLOGY.md` documents when to use unit / smoke / live MCP / `test-all-tools`.

### Fixed
- **C1.4 — `send_*_as_user` silently dropped messages with `oc_xxx` chat IDs**: cookie protobuf gateway's `PutMessageRequest.chatId` only recognizes numeric IDs; an `oc_xxx` was treated as unknown and the server returned an empty packet. Now auto-resolves `oc_xxx` via `getChatInfo(name) → cookie search(name) → numeric` and caches the mapping. Covers `send_as_user` / `send_image_as_user` / `send_file_as_user` / `send_post_as_user` / `send_card_as_user` / `batch_send`. Numeric IDs pass through unchanged. Resolution failure throws a clear error.
- **`list_wiki_nodes` returned 131006 in spaces the bot wasn't invited to**: `list_wiki_spaces` was already UAT-first, but `list_wiki_nodes` was bot-only. Made `list_wiki_nodes` UAT-first to match.
- **C1.15 — `get_user_info` showed current user as external tenant**: `getUserById` previously hit contact API first (requires `contact:user.base:readonly`); some OAuth configs returned no permission for same-tenant queries and the user was wrongly downgraded. Now UAT-first, contact API as fallback.
- **`manage_drive_file(action=delete)` printed `task=undefined`**: `DELETE /drive/v1/files/{token}` is synchronous and returns no `task_id`. Switched to `File deleted ({type})` when no task_id, `File deletion queued: task=...` when one is returned.
- **`send_image_as_user` failed silently**: cookie protobuf gateway rejects the simple `{imageKey}` content payload (HTTP 400) because Feishu Web actually encodes images with extra metadata (dimensions, MIME, thumbnails) that aren't in `proto/lark.proto`. Now throws a clear error pointing to `send_message_as_bot(msg_type="image", payload={image_key:"..."})` as the workaround. Wire format reverse-engineering deferred to v1.3.8 (needs Chrome DevTools traffic capture).
- Documented common error codes in tool schemas: 9499 (`manage_members` missing `member_id_type`, default `open_id`), 1062501 / 1061002 (`manage_drive_file` missing `type`).

### Changed
- **Phase A refactor**: 7,500-line `src/index.js` split into `src/tools/<domain>.js` (handlers + schemas) and `src/clients/official/<domain>.js` (API methods). `src/server.js` orchestrates registration; `src/tools/_registry.js` provides shared `ctx` (factories, profile state, `resolveDocId`). See `docs/REFACTOR-NOTES.md` for the file-responsibility matrix.
- **Tool consolidation (82 → 80)**: 21 bitable tools collapsed into 5 `manage_bitable_*` dispatchers (app / table / field / view / record, each with `action=list|create|update|delete|...`). 3 doc-block tools → `manage_doc_block(action=create|update|delete)`. 3 drive ops → `manage_drive_file(action=copy|move|delete)`. 2 download tools → `download_message_resource(kind=image|file)` + `download_doc_image`. Semantics unchanged; parameters collapsed onto an `action` field.
- **Writes default to UAT**: every `create`/`edit` for docx / bitable / drive / wiki / OKR / calendar / tasks runs through `_asUserOrApp` — UAT first, bot only as fallback. Forced bot fallback appends a ⚠ warning to the response (and points to `npx feishu-user-plugin oauth`) so the ownership shift surfaces immediately.
- **ID input normalization**: docx / bitable tools' `document_id` / `app_token` accept native token (`doccnXXX` / `docxXXX` / `bascnXXX`), wiki node token (`wikcnXXX` / `wikmXXX` / `wiknXXX`), and full Feishu URLs. Internally resolved via `getWikiNode` with a 10-minute cache.
- **Upload scope inventory**: `uploadMedia` / `upload_drive_file` / `upload_bitable_attachment` / `manage_doc_block(image_path|file_path)` collectively need `drive:drive`, `drive:file:upload`, `docs:document.media:upload`, and `sheets:spreadsheet` (sheet uploads only). Documented in CLAUDE.md and the OAuth scope table.
- **team-skills sync via PR**: post-merge hook in this repo now opens an auto-merging PR against team-skills instead of pushing to main. CI `validate.yml` enforces a version triangle across `plugin.json` / `SKILL.md` / `README.md` first `### vX.Y.Z` heading.

## [1.3.6] - 2026-05-03

### Added
- **Upload completeness**: `uploadDocMedia` → `uploadMedia` accepting 8 `parent_type`s (docx / sheet / bitable × image / file + legacy doc_*). New `create_doc_block` modes for files (`file_path` / `file_token`, block_type 23, auto view-wrap). `update_doc_block` accepts `file_token` to swap existing file blocks. New `upload_drive_file` (`drive/v1/files/upload_all`; optional `wiki_space_id` auto-attaches via `move_docs_to_wiki`). New `upload_bitable_attachment` (`parent_type=bitable_image|bitable_file`).
- **`batch_send` tool**: fan-out the same or different content to multiple targets in one call. Each target dispatches sequentially with anti-rate-limit throttling and reports per-target `ok` / `error`. Identity is the cookie user unless `target.via=bot`.
- **Multi-profile support**: `list_profiles` / `switch_profile` tools + `LARK_PROFILES_JSON` env. Hot-swap credentials without restarting the MCP server; cached client instances rebuild against the new profile.
- **`send_card_as_user` (bot-routed default)**: send Feishu interactive cards. v1.3.6 routes through the bot identity; the `as_user` suffix is reserved for v1.3.7's reverse-engineered cookie path. `via="user"` returns an explicit not-yet-implemented error.

### Changed
- OAuth scopes added: `drive:file:upload` (narrower scope for `drive/v1/files/upload_all`), `sheets:spreadsheet` (sheet image / file uploads). Existing users must re-run `npx feishu-user-plugin oauth` to pick them up.

## [1.3.5] - 2026-04-24

### Fixed
- **Cross-process UAT refresh lock**: file lock at `~/.claude/feishu-uat-refresh.lock` (`O_CREAT|O_EXCL`, 30s stale detection) serializes UAT refresh across concurrent MCP processes. Inside the critical section, the lock holder re-reads `~/.claude.json` to see whether a peer already rotated the token; if so it adopts the fresh one. Closes the "Codex spawned 6 MCP servers, all raced to refresh" failure mode that was burning refresh tokens on 2026-04-23.
- **`get_login_status` UAT health check**: now actually exercises the UAT (calls `listChatsAsUser({pageSize:1})`) instead of just checking presence. Surfaces "configured but 401" cases that previously stayed silent until the next real tool call.

### Added
- **Bot-fallback ⚠️ warning**: every write tool that silently fell back from UAT to bot identity (`create_doc` / `create_bitable` / `create_folder` / `create_doc_block` / etc.) now appends a `fallbackWarning` to the response so users see the ownership change immediately. Before, callers only learned days later when a teammate could read their "private" resource.
- **Auto-expand `merge_forward`**: `read_messages` / `read_p2p_messages` walk a `merge_forward` placeholder into its child messages by default (`expand_merge_forward=false` to opt out). Children carry `parentMessageId` (use that, NOT the child id, when downloading their media). Text children get `urls[]` + `feishuDocs[]` extracted so agents can feed them straight into `read_doc` / WebFetch.
- **`download_file` tool**: download a file attachment (`msg_type=file`). Returns base64 + mimeType + byte count; optional `save_path` writes to disk. Same parent-id rule for `merge_forward` children as `download_image`.

## [1.3.4] - 2026-04-22

### Added
- **Wiki-hosted content is now first-class**: every docx and bitable tool accepts the `document_id` / `app_token` parameter in three forms — native token (unchanged), wiki node token (`wikcnXXX` / `wikmXXX` / `wiknXXX`), or a full Feishu URL (`https://xxx.feishu.cn/docx/XXX`, `.../wiki/XXX`, `.../base/XXX`). A new `src/resolver.js` parses the input, calls `wiki/v2/spaces/get_node` when needed to resolve to `obj_token` + `obj_type`, and caches the mapping for 10 min. Zero-lookup path for direct URLs.
- **`get_wiki_node` tool**: explicitly resolves a Wiki node to its backing object (`obj_type` + `obj_token` + `space_id`). Useful when you need to branch behaviour on whether a node points at a docx, bitable, sheet, mindnote, file, or slides.
- **Create docx / bitable directly under Wiki**: `create_doc` / `create_bitable` accept optional `wiki_space_id` (and `wiki_parent_node_token` for nested placement). Plugin creates the resource in drive, then calls `wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki` to attach it. Returns `wikiNodeToken` on success, `wikiAttachTaskId` when Feishu queues the move, or a warning if attach fails (resource still in drive).
- **Docx image read**: `download_image` now has a docx mode — pass `image_token` (from `get_doc_blocks` image block) and optional `doc_token` (native / wiki node / URL). Routes through `drive/v1/medias/{token}/download`, returns base64 as MCP image content so the model sees the pixels.
- **Docx image write**: `create_doc_block` gains two shortcut parameters — `image_path` (local file) automatically runs the three-step Feishu flow (create empty image block → upload via `drive/v1/medias/upload_all` with `parent_type=docx_image` and the new block_id → patch with `replace_image`); `image_token` reuses an already-uploaded media token. `update_doc_block` accepts `image_token` to swap the picture in an existing image block.
- **`list_user_okrs` / `get_okrs` / `list_okr_periods` tools**: read a user's OKRs, batch fetch full objective + key result details (progress, alignments, mentions), and enumerate periods. UAT-first with app fallback when the OKR scope is granted.
- **`list_calendars` / `list_calendar_events` / `get_calendar_event` tools**: list the user's calendars (primary / shared / subscribed), list events in a time window, and fetch full event details (attendees, location, meeting links, attachments).

### Fixed
- **External-group `read_messages` hardening**: new `src/error-codes.js` classifies bot failures. Known-needs-UAT codes (`240001` external tenant, `70009` no permission, `70003` / `99991668` bot not in chat, `19001` chat not found) hop straight to UAT. Transient codes (`42101` rate limit, `5xx`, `ECONNRESET`, fetch timeouts) retry once after a 2 s delay before falling back. Response now includes `via: "bot" | "user" | "contacts"` and, when fallback fires, `via_reason` (e.g. `bot_external_tenant`). When the `chat_id` was discovered via `search_contacts` (i.e. definitely external) the bot path is skipped entirely.
- **Raw Feishu payload no longer leaks when UAT is missing**: bot failures with no UAT configured now produce `Cannot read chat <id> as bot (<reason>). To read external/private groups, configure UAT via: npx feishu-user-plugin oauth` — previously the caller got the unwrapped Feishu error JSON.
- **`_uatREST` array query params**: OKR / calendar endpoints that take repeated query keys (e.g. `period_ids=p1&period_ids=p2`) now serialize correctly. Previously `URLSearchParams(query)` would call `toString` on arrays and produce CSV, which Feishu rejects.

### Changed
- Tool count 67 → **74** (+7: `get_wiki_node`, `list_user_okrs`, `get_okrs`, `list_okr_periods`, `list_calendars`, `list_calendar_events`, `get_calendar_event`).
- `getWikiNode(nodeToken, _spaceId)` — `spaceId` parameter position swapped; retained only for backward-compatibility of any external caller. The endpoint itself ignores `space_id`.
- `create_doc_block` no longer requires `children` — callers who use the new `image_path` or `image_token` shortcut omit it. One of `children` / `image_path` / `image_token` must be provided.

## [1.3.2] - 2026-04-17

主线：以"真用户身份"补两个 longstanding gap —— 用户消息的 @-mention 现在真能通知到人 + 用户身份创建的 docx / bitable 资源现在真归你（不是 app）。

### Fixed
- **@-mentions 作为用户发送时不通知**：飞书 Web bundle 反向工程发现 `RichText` 需要 `atIds[]` (field 6) 注册 AT element ids，没有这个字段后端会把 `user_id` 清空。`proto/lark.proto::RichText` 扩字段（`atIds` / `anchorIds` / `imageIds` 等），加上真正的 `AtProperty` / `AnchorProperty` message。Live 测试：bot-API 回读现在保留 `user_id` + `user_name`（之前两个都空字符串）。
- **`create_doc` / `create_bitable` 创建后归属错乱**：所有 docx / bitable / drive 操作改走 UAT-first → app fallback（新 helper `_uatREST` + `_asUserOrApp`）。修复 1770032（docx forbidden）+ 91403（bitable forbidden）—— 之前 UAT 创建的资源用 app 路径打开会 403，因为根本不是 UAT 创的。

### Added
- **`ats: [{userId, name}]` 参数**给 `send_as_user` / `send_to_user` / `send_to_group` / `send_post_as_user`：在 TEXT 消息里 splice @-mention（marker `@<name>`）；在 POST/RichText 消息里 `sendPost` 把 AT elem ids 汇到 `richText.atIds`，AT 编码用 `AtProperty`。
- **`_formatMessage` surface `mentions[]`**：`im.message` payload 里 mentions 数组现在被 `read_messages` / `read_p2p_messages` 透传出来，供下游用 mention 的 name 直接 narrate 而不用再查 contact API。

### Changed
- Docs synced：`CLAUDE.md` / `skills/feishu-user-plugin/references/CLAUDE.md` / `.claude-plugin/plugin.json` 全部更新 @-mention 用法 + UAT-first 行为说明。
- Removed redundant per-resource as-user wrappers：`createDocAsUser` / `createBitableAsUser` / `createFolderAsUser` 删除，被 `_asUserOrApp` 统一替代。

## [1.3.1] - 2026-04-17

主线：MCP 稳定性 root fix + 用户身份创建 + Codex 双客户端支持 + 工具表收敛（81 → 66，去 calendar/tasks 这种 app 权限未开通的伪能力）。

### Fixed
- **MCP 中途掉线（root cause #1）**：Lark SDK 的 logger 默认写 stdout 污染了 JSON-RPC channel。`src/index.js` 启动把 SDK logger 改写到 stderr（PR #2 by [@ZYAH111](https://github.com/ZYAH111)）。
- **uncaughtException / unhandledRejection 兜底**：MCP server 不再因为单个 tool handler 抛错而整个 crash —— 进程级 handler 把错误吐到 stderr，server 继续接 next request。
- **config 写入 race**：`atomicWrite(tmp + rename)` 替代直接 fs.writeFile，防止 Claude Code spawn 多 MCP server 时并发改 `~/.claude.json` 互相覆盖。

### Added
- **UAT-first creation**：`create_doc` / `create_bitable` / `create_folder` 现在用 `LARK_USER_ACCESS_TOKEN` 走 UAT 路径创建，资源归用户而非 app。
- **Codex TOML 支持**：`npx feishu-user-plugin setup --client codex|both` 写 `~/.codex/config.toml::mcp_servers`。新增 `scripts/mcp_stdio_bridge.js` 适配 Codex 协议差异。
- **3-layer 版本确认**：CLAUDE.md 规则 + `prepublishOnly` script + CI tag check，三层保护防版本号 drift。
- **5 个新 bitable 工具**：`get_bitable_meta`、`copy_bitable_app`、`update_bitable_table`、`create_bitable_view`、`delete_bitable_view`。

### Changed
- **工具数 81 → 66**：移除 calendar(5) + tasks(5) 工具 —— 飞书 app 权限管理后台对应 scope 未开通，工具调用 100% 失败。后续在 v1.3.4 重新加回时 app 权限已申请。
- **合并 pin/unpin → `pin_message(action='pin'|'unpin')`**，`add/remove_members → manage_members(action=...)`。
- **吸收单 record CRUD 到 batch tools**：`create_bitable_record` → `batch_create_bitable_records(records=[<one>])` 等。
- **OAuth scopes**：加 `docx:document`、`drive:drive` write 权限。

## [1.3.0] - 2026-04-03

主线：tool surface 一次性扩张 46 → 76（+30）—— bot messaging 全套、docx block 编辑、calendar / tasks / drive 操作首次纳入。

### Added
- **IM 域（13 工具）**：`send_message_as_bot`、`delete_message`、`update_message`、`add_reaction`、`delete_reaction`、`pin_message`、`unpin_message`、`create_group`、`update_group`、`list_members`、`add_members`、`remove_members`。
- **Docx block 编辑（3 工具）**：`create_doc_block`、`update_doc_block`、`delete_doc_blocks` —— 飞书 docx 的原子编辑单元。
- **Bitable（2 工具）**：`get_bitable_record`（按 record_id 取一条）、`delete_bitable_table`。
- **Drive 操作（3 工具）**：`copy_file`、`move_file`、`delete_file`。
- **Calendar（5 工具）**：`list_calendars`、`create_calendar_event`、`list_calendar_events`、`delete_calendar_event`、`get_freebusy`。（v1.3.1 因 scope 未开通暂时下线，v1.3.4 加回。）
- **Tasks（5 工具）**：`create_task`、`get_task`、`list_tasks`、`update_task`、`complete_task`。（v1.3.1 因 scope 未开通暂时下线，v1.3.7 v2 API 重做。）

## [1.3.3] - 2026-04-20

### Fixed
- **MCP mid-session disconnect (root fix)**: All raw `fetch` calls to Feishu now go through `fetchWithTimeout` (AbortController, 30s default). A stalled connection used to hang a tool handler indefinitely; the MCP client would time out and some clients tore down the stdio transport — observed as "MCP 中途掉线" on v1.3.2. This was the real cause, not just the v1.3.1 stdout pollution.
- **stdout pollution (defense-in-depth)**: `src/index.js` now globally redirects `console.log` / `console.info` to stderr at startup, before any other `require`. Any current or future dependency that accidentally writes to stdout can no longer corrupt the JSON-RPC channel. (v1.3.1's Lark-SDK-specific logger override stays as-is.)
- **`(as user)` label lied for docs/bitable/folder creation**: `create_doc` / `create_bitable` / `create_folder` previously labeled every successful call `(as user)` whenever `LARK_USER_ACCESS_TOKEN` was set, even when the UAT call actually failed and silently fell back to app identity. `_asUserOrApp` now threads a real `_viaUser` flag through; failures show `(as app — UAT unavailable or failed; <resource> owned by the app, not you)`.

### Added
- **APP_ID startup validation**: MCP server probes `/auth/v3/app_access_token/internal` at boot. Invalid `LARK_APP_ID` / `LARK_APP_SECRET` (wrong-tenant, stale, or hallucinated by an autoinstall) now produce a clear stderr error pointing at the team-skills install prompt. Non-blocking — users running cookie-only workflows are unaffected.
- **`get_login_status` shows app identity**: Now returns the actual `app_id` plus fetched app name, so users can immediately spot "this isn't my team's app" scenarios.
- **`download_image` tool**: Download an image embedded in a message by `message_id` + `image_key`, returned as MCP image content so the model can see the pixels (not just the key string). Tries UAT first (works for any chat the user is in); falls back to app token (requires the bot to be in the chat).

### Changed
- Tool count 66 → **67** (added `download_image`).
- README tool badge corrected from 76 → 67 (previous 76 was stale and never matched the actual export).

## [1.1.3] - 2026-03-11

### Fixed
- **Case-insensitive chat name matching**: All name resolution strategies (bot group list, im.chat.search, search_contacts) now use case-insensitive matching. "ai技术解决" now correctly matches "AI技术解决（内部）".
- **expires_in NaN bug**: UAT token refresh and OAuth now validate `expires_in` field, defaulting to 7200s if missing/invalid, preventing NaN corruption in config.
- **_populateSenderNames inefficiency**: Fixed redundant condition in cookie-based name fallback.
- **OAuth silent persistence failure**: Now logs warnings when token persistence to `~/.claude.json` fails, instead of silently swallowing errors.
- **Null safety**: Added null check in `resolveToOcId` for undefined chat_id.

## [1.1.2] - 2026-03-11

### Fixed
- **Double OAuth on first install**: `oauth.js` now writes tokens to both `.env` and `~/.claude.json` MCP config directly, so MCP restart picks them up immediately without needing a second OAuth run.
- **readMessagesAsUser fails with start_time but no end_time**: Auto-sets `end_time` to current timestamp when `start_time` is provided but `end_time` is not, preventing "end_time earlier than start_time" error.
- **read_p2p_messages rejects chat names**: Now resolves user/group names automatically via search_contacts.
- **External group messages show sender IDs instead of names**: `_populateSenderNames` now falls back to cookie-based user identity lookup for external tenant users.

## [1.1.1] - 2026-03-11

### Fixed
- **read_messages can't read external groups**: `read_messages` now auto-falls back to UAT when bot API fails (e.g. bot not in group, external groups). No need to manually switch to `read_p2p_messages`.
- **Chat name resolution for external groups**: Added Strategy 3 using `search_contacts` (cookie-based) to find groups not visible to bot or `im.chat.search`.
- **Numeric chat IDs not accepted by read_messages**: `resolveToOcId` now passes through numeric IDs directly.

## [1.1.0] - 2026-03-11

### Fixed
- **read_messages 400 error hidden**: Now shows actual Feishu error code and description instead of just "Request failed with status code 400"
- **Messages returned oldest first**: Default sort is now `ByCreateTimeDesc` (newest messages first) for both `read_messages` and `read_p2p_messages`
- **Chat name resolution**: Added `im.v1.chat.search` API as fallback when bot's group list doesn't contain the target chat
- **get_user_info fails for external users**: Added official contact API fallback (`contact.user.get`) for cross-tenant user lookup
- **Messages lack sender names**: `read_messages` and `read_p2p_messages` now auto-resolve sender IDs to display names
- **UAT persistence writes to npx temp dir**: Now persists refreshed tokens to `~/.claude.json` MCP config instead
- **oauth-auto.js missing offline_access scope**: Added `offline_access` to SCOPES (was missing, causing no refresh_token)
- **README "8 slash commands"**: Corrected to "9 slash commands" (was missing /drive)
- **CLAUDE.md false "type: stdio" warning**: Removed — `"type": "stdio"` is standard and harmless in Claude Code

### Added
- `sort_type` parameter for `read_messages` and `read_p2p_messages` (`ByCreateTimeDesc` / `ByCreateTimeAsc`)
- `senderName` field in message results (auto-resolved from sender ID)
- CLI subcommands: `npx feishu-user-plugin setup` (wizard), `oauth`, `status`
- `src/cli.js` — CLI dispatcher for subcommands
- `src/setup.js` — Interactive setup wizard (writes MCP config, validates credentials)
- `chatSearch()` method in official client (uses `im.v1.chat.search`)
- `getUserById()` method with caching for user name resolution
- `_safeSDKCall()` wrapper that extracts real Feishu errors from Lark SDK AxiosErrors
- `_populateSenderNames()` for batch sender name resolution in message lists

### Changed
- `package.json` bin entry points to `src/cli.js` (supports subcommands, default still starts MCP server)
- team-skills README rewritten for pure npm flow (no clone needed)
- CLAUDE.md OAuth instructions updated to use `npx feishu-user-plugin oauth`
- Error messages across all 33 tools now include actual Feishu error codes

## [1.0.2] - 2026-03-10

### Fixed
- `list_user_chats` description incorrectly claimed "including P2P" — actually only returns groups
- OAuth scope `contact:user.id:readonly` → `contact:user.base:readonly` in README
- Cookie length validation range (500-5000, was 1000-5000)
- Version inconsistency across `server.json`, `plugin.json`, `SKILL.md`, `src/index.js`
- Skill count: 8 → 9 (was missing `/drive`)
- README_CN.md Claude Desktop config missing `env` block

### Added
- Startup auth diagnostics in `src/index.js` (Cookie/App/UAT status logging)
- `LARK_USER_REFRESH_TOKEN` to all MCP config examples
- Troubleshooting for `invalid_grant` errors (28003/20003/20005)
- Troubleshooting for `oauth.js` requiring APP_ID/SECRET in `.env`
- Playwright cookie setup: two-step extraction, `clearCookies()`, ASCII validation
- `LARK_USER_REFRESH_TOKEN` to `server.json` environment_variables

### Changed
- All 5 env vars marked as required for full functionality
- Improved `read_p2p_messages` chat_id description (numeric + oc_xxx both accepted)

## [1.0.0] - 2026-03-09

### Changed
- Renamed from `feishu-user-mcp` to `feishu-user-plugin`
- Converted to Claude Code Plugin standard structure (`.claude-plugin/`, `skills/`)
- Skills moved from `.claude/commands/` to `skills/feishu-user-plugin/references/`
- MCP server config template added (`.mcp.json`)
- All client configurations now use `npx -y feishu-user-plugin`
- Version reset to 1.0.0

### Added
- `.claude-plugin/plugin.json` — Plugin metadata
- `skills/feishu-user-plugin/SKILL.md` — Main skill definition with allowed-tools
- `skills/feishu-user-plugin/references/CLAUDE.md` — Troubleshooting guide

### Fixed
- Version number consistency across `package.json`, `src/index.js`, and `server.json`

## [0.5.1] - 2026-03-08

### Fixed
- `search_docs` — SDK method `docx.builtin.search` does not exist; switched to `client.request()` with `/open-apis/suite/docs-api/search/object`
- `search_wiki` — SDK method `wiki.node.search` does not exist; switched to suite docs search API
- Message timestamp parsing — Feishu returns millisecond strings; added `_normalizeTimestamp()` to convert to seconds

### Changed
- Updated README to reflect all 33 tools with full documentation
- Updated `server.json` manifest with complete tool list
- Updated `.env.example` with UAT fields

### Added
- `src/test-all.js` — comprehensive test suite for all tools

## [0.5.0] - 2026-03-06

### Added
- P2P (direct message) chat reading via `read_p2p_messages`
- OAuth v2 authorization flow (`src/oauth.js`, `src/oauth-auto.js`)
- `list_user_chats` — list all chats the user is in
- Third auth layer: User OAuth UAT for P2P access
- Auto-refresh of `user_access_token` with `.env` persistence

## [0.4.0] - 2026-03-04

### Added
- Multi-type messaging: image, file, rich text (post), sticker, audio
- Cookie heartbeat — auto-refresh CSRF every 4h to extend session
- Chat name auto-resolution — pass group name instead of `oc_xxx` ID

## [0.3.0] - 2026-03-01

### Added
- Initial release: 27 tools, 8 slash commands, dual backend
- User identity messaging via reverse-engineered Protobuf protocol
- Official API integration for docs, Bitable, wiki, drive, contacts
- Support for Claude Code, Claude Desktop, Cursor, VS Code, Windsurf
