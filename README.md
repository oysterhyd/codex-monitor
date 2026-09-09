# Codex Monitor

Windows desktop application for monitoring local Codex usage, account quotas, token costs, and task performance. Supports 简体中文 and English.

## Download

[Download v1.0.2 for Windows x64](https://github.com/oysterhyd/codex-monitor/releases/tag/v1.0.2)

Run `Codex-Monitor-Setup-1.0.2.exe`. The installer supports per-user installation and upgrading an existing copy. Closing the window keeps monitoring active in the system tray; use **Quit / 退出** to exit fully.

The installer is unsigned. Automatic updates and cross-device synchronization are not included.

## 1.0.2

账号切换统一在顶部筛选栏；默认显示当前账号，额度不再混合多个账号。额度窗口采用玻璃分段按钮，历史曲线横轴遵循所选日期范围。

## 1.0.1

修正筛选栏布局：时间按钮保持左侧原位，账号筛选位于右侧模型筛选之前；保留原有滑动动画。

## 1.0.0

- View usage, estimated costs, task records, runtime metrics, quota history, and CSV exports by account.
- Add historical accounts and edit their display names in **Settings → Account management**.
- Assign unassigned records by date range in **History**. Expand a task record to assign or correct that task individually; task assignment does not change quota snapshots.
- Account-specific quota snapshots remain separate, including identically named quota windows.
- Centered glass navigation, rounded panels, animated charts and date-range controls.
- Persistent Chinese/English language selection, including tray menus and confirmation dialogs.
- Existing statistics, pricing, and settings migrate on upgrade.

## 多账号使用

1. 顶部筛选区默认选择「当前账号」，也可手动选择历史账号或「未归属」。总览、历史可选择「全部账号」汇总用量；额度始终只显示一个账号，汇总模式下显示当前登录账号。
2. 在「设置与价格 → 账号管理」添加历史账号或修改名称。
3. 旧记录缺少账号信息时不会自动归入当前账号。在「历史分析」确认日期范围，在顶部选择目标账号并点击「将未归属记录归入…」。此批量操作覆盖该时间范围的未归属用量、任务与额度，不受模型、项目筛选影响。
4. 同一天使用多个账号时，可展开「任务运行记录」，使用顶部所选账号并点击「归属至…」。它只更改该任务的用量与任务记录，不修改额度快照。
5. 旧账号可查看保留的记录；在线额度查询只使用当前 Codex 登录账号，不会自动登录其他账号。

## Account attribution boundaries

Codex statistical logs generally do not contain an account identifier. Pre-upgrade records remain **Unassigned** until you assign them; they are not assumed to belong to the current login.

While monitoring is running, account attribution uses sampled local sign-in state and record timestamps. Gaps during account changes, application shutdown, or pauses longer than 15 seconds remain unassigned. A very brief switch away and back between observations may not be detected; task attribution can be corrected manually. A shared task spanning accounts shows only the selected account’s usage contributions, while task duration remains the duration recorded for the whole task.

Account identity combines the selected account and login user into a SHA-256 identifier. The database stores only that identifier and a display name. It does not store passwords, authentication tokens, or API keys. Original Codex logs are not modified.

## Features

- Overview: remaining quota, tokens, API-equivalent estimated cost, cache hit rate, model distribution, and output speed.
- History: model/project/task breakdown, paginated task records, per-model cost details, and account attribution.
- Quota: latest window snapshots and step charts that preserve reset boundaries and sampling gaps.
- Settings: language, theme, launch at sign-in, quota alert muting, query interval, data locations, model price versions, and account names.
- Incremental background collection with worker recovery and database corruption backup/recovery.
- CSV export of the current filters, including the account identifier. Formula-like CSV values are escaped.

## Measurement and privacy

API-equivalent cost is an estimate, not a subscription bill. Included price defaults use Standard short-context rates verified on 2026-09-09; long-context, Fast, regional adjustments, and later price changes may require manual pricing versions. Unknown model prices remain unpriced.

Quota snapshots may include activity on other devices. Token statistics cover locally available Codex Desktop statistical records. CLI-origin sessions are excluded. Task output rates include tool and wait time; generation-only speed is not available from these logs.

Only statistical records are parsed into the monitoring database; message and tool bodies are not stored. Online quota queries use the existing local Codex App Server authentication. Data stays on the local computer. Database recovery preserves readable settings, pricing, account metadata, and manual usage attribution; corrupt historical samples may be unavailable. Backups are retained in the data directory.

## Build from source

Requires Windows, Node.js with `node:sqlite` support, npm, and a local Codex installation for live data.

```powershell
npm ci
npm run build
npm start
npm run package
```

Built installers are written to `release/`. Browser-only development (`npm run dev`) previews the shell without connecting to local account data. The public repository contains the application source; local integration fixtures, account data, screenshots, and credentials are excluded.

## Stack

Electron 44, React 19, Vite 8, SQLite, and Phosphor icons.
