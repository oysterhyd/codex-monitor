# CLAUDE.md

## Project

Codex Monitor is a Windows x64 application with a MyGO native main window and Go data service. Electron/React is used only for the retained transparent desktop widget. UI copy defaults to Simplified Chinese and supports English.

## Commands

Use PowerShell 7. Install Node dependencies with `npm ci`; Go 1.27.1 is required by go.mod. `scripts/go.cjs` resolves GO_EXE, the local Windows Go installation or PATH.

- `npm start`: build and launch the native app.
- `npm run build`: produce the complete portable app under build/native.
- `npm test`: Go tests plus the widget refresh test.
- `npm run native:check`: isolated native-window acceptance, including five pages, motion, window controls and widget transport.
- `npm run widget:check`: isolated real Electron widget acceptance, using the Go service.
- `npm run test:ui`: both UI acceptance suites.
- `npm run widget:build`: build only the widget renderer into dist.
- `npm run dev`: widget renderer debugging; data requires the Electron bridge.

Close the running monitor before replacing its executable. GUI close hides to tray; tray Exit fully stops it. Ship the entire build/native directory, including widget/runtime.

## Architecture

- main.go embeds icons and assets/locales JSON dictionaries and starts internal/nativeapp.
- internal/nativeapp owns the MyGO pages, tray, window behavior, transitions and widget bridge.
- internal/monitor owns SQLite, Codex/Pi parsing and scans, accounts, price versions, statistics, quotas and actions. A single serialized service owns the database.
- electron/native-widget.cjs authenticates to the Go parent over a private loopback socket. widget-window.cjs owns placement, drag and widget-window.json. widget-preload.cjs exposes the narrow renderer bridge.
- src contains only the React widget and its formatting/refresh helpers. The HTML entry always mounts the widget.
- internal/testfixture and cmd/fixture generate synthetic acceptance profiles. UI tests also seed temporary profiles automatically; no personal corpus or old implementation is needed.

See docs/architecture.md for data contracts and maintenance rules. There is no Electron main dashboard, Node data worker, or legacy installer build.

## Invariants

Do not write Codex/Pi source files or persist message bodies, tool calls, tokens or API keys. Keep unknown costs, cache rates and quotas distinguishable from zero. Deduplicate modern records by response id and use differences for legacy cumulative records. Keep account filters and widget scope consistent: widget usage covers all local accounts, while quota belongs to the current Codex account. Respect clear-history boundaries and preserve manual price versions.

Renderer sandbox, context isolation and sender validation must remain enabled. Do not broaden the widget preload API. The widget must never open SQLite. Quota charts are discrete step observations and break at resets/gaps. Preserve the fixed 560x380 widget bounds and its existing animation/drag behavior. Respect reduced motion in both interfaces.

All tests must use synthetic temporary profiles. Keep build, dist, artifacts and databases out of Git. Retain .git; do not push or publish without authorization.
