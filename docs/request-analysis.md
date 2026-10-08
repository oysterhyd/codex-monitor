# 逐次用量与首字分析

历史分析包含“任务分析”和“逐次调用”。Desktop、Codex CLI、MonoCode 和已配置的 Pi 来源继续按原来的规则采集，列表不显示来源列，也不需要 API Key。

## 查看记录

在“逐次调用”中，每条用量记录显示时间、状态、模型、首字时间、输入 / 输出 Token、缓存命中和 API 等值估算。可以按响应 / 记录 ID、任务、会话、项目或模型搜索，按用量 / 失败 / 重试筛选，并按时间、Token、费用或首字时间排序。每页 50 条；列表内部可滚动，点击或按 Enter 展开详情。当前筛选可导出 CSV，包含 TTFT、HTTP 状态、错误类别和重试序号。

任务运行记录展开后增加“任务内调用分析”，按时间展示该轮次全部关联记录，每页 25 条。显示用量条数、失败 / 重试事件数、首字样本数、平均和 P95 首字时间；展开单条可查看任务 Token 占比及已定价费用占比。任务详情保留完整轮次，遵循账号筛选；调用列表及导出遵循时间、账号、模型、项目和调用筛选。顶部全局汇总仍遵循全局筛选。

缓存输入已包含在输入 Token 中，推理 Token 已包含在输出 Token 中，不能重复相加。费用按原有价格生效时间计算，属于 API 等值估算，并非官方订阅实付账单。未定价、未采集 TTFT 或没有独立用量的失败事件保持未知。

新版 Codex 的 `token_usage_record` 按响应 ID 去重；旧日志显示累计差分记录，不能保证每条差分对应一个完整请求。Pi 延续原有会话及响应去重规则，目前每个 assistant 用量消息对应一个任务轮次。

## 开启首字时间（TTFT）

首字时间是单次模型请求发出至首次模型内容输出的等待时间，包含首次推理 / 文本 / 工具流内容，不是整个任务耗时。Codex 使用其完成事件中明确的 `ttft_ms`；Pi 扩展使用 provider 请求前与首次非空内容增量的单调时钟，兼容复用 WebSocket 的请求。平均 / P95 使用已关联用量的 TTFT 样本；失败后仍有明确首字时间的诊断行也会显示该值。没有数据时不会用相邻日志时间差补算，也无法补回未采集的历史 TTFT。

1. 打开“设置与价格 → 通用 → 本机首字采集”，打开开关。
2. 默认接收地址为 `http://127.0.0.1:4319/v1/logs`。如端口被占用，可修改端口并点击“应用端口”。修改后同步更新客户端配置或重新导出 Pi 扩展。
3. 为各客户端完成下面的配置，保持 Monitor 在后台运行。

开关只启动 Monitor 的本机接收器，不会自动修改 Codex 配置或加载 Pi 扩展。“采集已开启”表示接收端口就绪；完成客户端配置并产生新调用后，才会出现“最近接收”和首字样本。用量记录、日志中的重试事件可以独立采集到，因此看到这些记录并不代表首字采集已接通。开启前的历史记录仍会显示“未知”。

### Codex Desktop / CLI

点击“复制 Codex 采集配置”，将内容合并到实际 `CODEX_HOME/config.toml`（默认 `%USERPROFILE%\.codex\config.toml`）。已有 `[otel]` 段时修改其对应字段，避免重复段或重复 `exporter`。配置完成后重启 Desktop / CLI；分别使用不同 `CODEX_HOME` 的客户端需分别配置。

```toml
[otel]
log_user_prompt = false
exporter = { otlp-http = { endpoint = "http://127.0.0.1:4319/v1/logs", protocol = "json" } }
```

该配置使用官方 Codex 的 OTel 日志导出，对官方订阅和 CLI 同样适用。Monitor 接收 OTLP HTTP JSON（支持 gzip），不提供 OTLP gRPC / protobuf 接口。Codex 异步批量导出，事件可能晚于会话日志到达，界面会在收到并关联后更新。

配置依据：[官方 Codex 可观测性文档](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry)。如果已有其他 OTel exporter，请自行选择采集目标；Monitor 不覆盖已有配置或转发事件。

### Pi

点击“导出 Pi 扩展”，程序将内置的 `codex-monitor.ts` 写入 Monitor 数据目录的 `integrations/pi/`，并复制加载命令。该扩展使用本机已安装 Pi 的 provider / message hooks，已在 `@earendil-works/pi-coding-agent` 1.1.0 验证加载。

```powershell
pi -e "$env:APPDATA\codex-monitor\integrations\pi\codex-monitor.ts"
```

如需自动加载，可将导出文件复制到 `PI_CODING_AGENT_DIR/extensions/codex-monitor.ts`（默认 `%USERPROFILE%\.pi\agent\extensions\codex-monitor.ts`），然后重启 Pi 或执行 `/reload`。自动加载后正常启动 `pi` 即可，无需再用 `-e` 加载另一份相同扩展。

扩展不会更改模型请求、正文或认证配置，只发送时间、Token 签名、响应 ID、模型和诊断类别。延续原有官方登录识别规则：`openai-codex`，或能通过当前本机 OAuth 配置识别的 `openai`；不扩展到未知 API 登录来源。Monitor 接收失败时不阻塞或改变模型结果；未启动 Monitor 时的诊断不会保存到磁盘。

如手动加载仓库中的扩展，可使用 `integrations/pi/codex-monitor.ts`。自定义接收端口时设置 `CODEX_MONITOR_OTEL_URL=http://127.0.0.1:<端口>/v1/logs`，扩展只接受 `127.0.0.1` 上的 HTTP 目标。Pi 需要支持 `before_provider_request`、`before_provider_headers`、`after_provider_response`、`message_update` 和 `message_end` 钩子；没有请求开始或首内容事件的记录保持未知。

## 失败、重试与关联口径

- Codex 用量扫描同时只读读取 `CODEX_HOME` 下最高版本的 `logs_*.sqlite`，提取客户端明确记录的 sampling retry。诊断数据库缺失或格式暂不支持，不影响原有用量采集。
- OTel 的 API / SSE / WebSocket 错误记录补充失败事件、可用的 HTTP 状态和请求尝试序号。HTTP 成功的重试尝试也可记录为重试事件。流重试和 HTTP 重试属于不同层级，事件数不等于所有网络请求的精确重试次数。
- Pi 扩展记录 provider 可见的失败及重复请求尝试；显式请求关联键将重试和最终用量归入同一个 Pi 响应轮次。Pi 在钩子以下完成、未暴露的内部重试无法统计。
- TTFT 优先按响应 ID 关联。当前 Codex OTel 缺少响应 ID 时，只关联同会话、模型、Token 签名且相差不超过 2 秒的唯一用量候选，界面标注“按时间与 Token 唯一匹配”。多个候选时保留未关联数据，不猜测。
- Codex 错误事件有轮次 ID 时直接归属；缺少轮次 ID 时，仅在该事件时间对应一个唯一任务区间时归属。无法确定的事件仍可在逐次列表中查看。
- 没有 `usage` 的失败 / 重试事件不贡献 Token 或费用；部分失败可能另有带用量的记录。因此此处展示观测到的事件，不计算未经完整采集证明的请求成功率。

## 数据与验证

数据库结构升级到版本 3，新增 `request_events` 及索引；不更改原始会话、现有账号、价格、设置或清空历史边界。清空历史同时清除请求事件，并阻止清空时间以前的 OTel 批次重新写入。数据库备份修复保留新增表和结构版本。

接收器只监听 `127.0.0.1`，随采集开关及服务生命周期启停；离线模式不监听。请求有大小和超时限制。接收时按字段白名单丢弃正文、工具内容、账户身份及 headers；错误原文转换为限流、超时、连接、认证、服务等固定类别后保存，无外部转发。

```powershell
go test ./...
npm run test:pi
npm run native:check
```

测试使用合成数据，覆盖关联歧义、晚到事件、去重、Pi 响应键与重试关联、账号筛选、任务占比、未知费用 / TTFT、分页、CSV、诊断游标重建、清空边界、HTTP 接收验证及界面键盘展开。Pi 扩展也通过了真实 Pi RPC 启动加载检查，该检查未发起模型请求。
