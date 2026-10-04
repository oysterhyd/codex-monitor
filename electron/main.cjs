const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  Notification,
  nativeTheme,
  dialog,
  shell,
} = require("electron");
const { WorkerManager } = require("./worker-manager.cjs");
const { readQuota, stopQueries } = require("./quota.cjs");
const { createWidget, savedWidgetMode } = require("./widget-window.cjs");
const path = require("node:path"),
  fs = require("node:fs"),
  os = require("node:os");
let win,
  widget,
  tray,
  worker,
  quitting = false,
  settings = {},
  widgetMode = false;
const { translate } = require("./translate.cjs");
const tr = (message, ...values) => translate(settings.language, message, ...values);
// App icon: notification, dashboard window and tray share this one path.
const iconPath = path.join(__dirname, "../assets/icon.png");
const smoke = process.env.MONITOR_TEST_DATA;
if (smoke) app.setPath("userData", path.resolve(smoke));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) restoreMain();
  });
  function restoreMain() {
    setWidgetMode(false);
    win.show();
    win.focus();
  }
  function setWidgetMode(on) {
    widgetMode = !!on;
    win.webContents.send("widget:mode", widgetMode);
    if (widgetMode) {
      win.hide();
      widget?.show();
    } else {
      widget?.hide();
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) {
        win.show();
        win.webContents.send("app:enter");
      }
    }
    if (tray) trayMenu();
  }
  function request(method, args) {
    if (quitting) return Promise.reject(new Error('应用正在退出'));
    return worker.request(method,args);
  }
  function notifyUI(data) {
    if (quitting) return;
    if (win && !win.isDestroyed()) win.webContents.send("update", data);
    if (widget && !widget.window.isDestroyed() && widget.window.isVisible()) widget.window.webContents.send("update");
  }
  // The single place settings land in the running app: nativeTheme and the tray rebuild
  // must follow every settings write, whether it came from the renderer or a worker reply.
  function applySettings(next) {
    settings = next;
    nativeTheme.themeSource = settings.theme;
    trayMenu();
    notifyUI();
    return settings;
  }
  function refreshQuietly() {
    request("refresh").catch(() => {});
  }
  function trayMenu() {
    tray.setToolTip(tr("Codex Monitor · 本机用量监测"));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: tr("打开 Codex Monitor"), click: restoreMain },
        { label: "桌面小组件 / Desktop widget", type: "checkbox", checked: widgetMode, click: item => setWidgetMode(item.checked) },
        { label: tr("刷新额度"), click: refreshQuietly },
        {
          label: tr("静音提醒"),
          type: "checkbox",
          checked: !!settings.muted,
          click: async (item) => {
            applySettings(await request("settings", { muted: item.checked }).catch(()=>settings));
          },
        },
        { type: "separator" },
        {
          label: tr("退出"),
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
  }
  app.whenReady().then(async () => {
    app.setAppUserModelId("local.codex.monitor");
    const data = app.getPath("userData");
    fs.mkdirSync(data, { recursive: true });
    try { widgetMode = savedWidgetMode(data); } catch {}
    // One Codex-home resolution serves the worker's scanner and the snapshot paths.
    const codexHome =
      process.env.MONITOR_CODEX_HOME ||
      process.env.CODEX_HOME ||
      path.join(os.homedir(), ".codex");
    const piHome = process.env.MONITOR_PI_HOME || process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
    // Test profiles never read personal Pi sessions unless explicitly requested.
    const piSessions = process.env.MONITOR_PI_SESSIONS ||
      (process.env.MONITOR_TEST_DATA && !process.env.MONITOR_PI_HOME ? null :
        process.env.PI_CODING_AGENT_SESSION_DIR || path.join(piHome, 'sessions'));
    worker = new WorkerManager(path.join(__dirname, "worker.cjs"), {
        db: path.join(data, "monitor.sqlite"),
        home: codexHome,
        piHome: piSessions ? piHome : null,
        piSessions,
    });
    worker.on("message", async (msg, reply) => {
      if (msg.type === "readQuota") {
        try {
          reply({
            quotaReply: true,
            result: await readQuota(msg.data),
          });
        } catch (e) {
          reply({ quotaReply: true, error: e.message });
        }
        return;
      }
      if (msg.type === "quota" && !msg.data.muted && !smoke) {
        for (const q of msg.data.groups)
          for (const slot of ["primary", "secondary"]) {
            const w = q?.[slot];
            if (
              !w ||
              w.usedPercent == null ||
              !w.resetsAt ||
              w.resetsAt * 1000 < Date.now()
            )
              continue;
            const remaining = Math.max(0, 100 - w.usedPercent);
            for (const threshold of [20, 10])
              if (remaining <= threshold) {
                const key = [msg.data.account, q.limitId, slot, w.resetsAt, threshold].join(":");
                if (await request("notice", key).catch(()=>false))
                  new Notification({
                    title: tr("Codex 额度提醒"),
                    body: tr("{0} · {1} 分钟窗口剩余 {2}%", q.limitName || q.limitId || "Codex", w.windowDurationMins, remaining.toFixed(0)),
                    icon: iconPath,
                  }).show();
              }
          }
      }
      notifyUI(msg);
    });
    win = new BrowserWindow({
      width: 1380,
      height: 960,
      minWidth: 920,
      minHeight: 680,
      show: false,
      backgroundColor: "#111514",
      title: "Codex Monitor",
      icon: iconPath,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    win.on("show", () => { if (!win.isMinimized()) widget?.hide(); });
    win.once("ready-to-show", () => {
      if (!process.argv.includes("--hidden") && !widgetMode && !win.isMinimized()) win.show();
    });
    tray = new Tray(iconPath);
    tray.on("double-click", restoreMain);
    trayMenu();
    // One sender gate serves every window family: the dashboard channels below and
    // the widget: loop after createWidget. The check stays per-handler by design.
    const handle = (name, fn, sender = win.webContents) =>
      ipcMain.handle(name, (event, arg) => {
        if (event.sender !== sender) throw new Error(tr("无效来源"));
        return fn(arg);
      });
    handle("snapshot", async (filter) => {
      const s = await request("snapshot", filter || {});
      settings = s.settings;
      return {
        ...s,
        paths: { data, home: codexHome, piSessions },
        version: app.getVersion(),
      };
    });
    handle("refresh", () => request("refresh"));
    handle("settings", async (value) => {
      const next = applySettings(await request("settings", value));
      if (!smoke && typeof value.autoStart === "boolean")
        app.setLoginItemSettings({
          openAtLogin: next.autoStart,
          path: app.getPath("exe"),
          args: ["--hidden"],
        });
      return next;
    });
    handle("account", value => request("account", value));
    handle("widgetMode", (on) => { if (typeof on === 'boolean') setWidgetMode(on); return widgetMode; });
    handle("price", (value) => request("price", value));
    handle("deletePrice", async (value) => {
      const result = await dialog.showMessageBox(win, {
        type: "warning",
        title: tr("删除价格版本"),
        message: tr("确认删除 {0} 的价格版本 v{1}？", value.model, value.id),
        detail: tr("删除后，相关历史记录可能使用其他价格版本或显示为未定价。"),
        buttons: [tr("取消"), tr("删除")],
        defaultId: 0,
        cancelId: 0,
      });
      return result.response === 1 ? request("deletePrice", value.id) : null;
    });
    handle("export", async (filter) => {
      const result = await dialog.showSaveDialog(win, {
        title: tr("导出当前筛选的用量"),
        defaultPath: `codex-usage-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (result.canceled) return null;
      const text = await request("export", filter);
      await fs.promises.writeFile(result.filePath, text, "utf8");
      return result.filePath;
    });
    handle("clear", async () => {
      const r = await dialog.showMessageBox(win, {
        type: "warning",
        title: tr("清空监测历史"),
        message: tr("删除本应用已采集的用量和额度历史？"),
        detail:
          tr("Codex 与 pi 原始文件不会被修改。仅继续采集此刻之后的数据；已有历史不会自动重新导入。价格和设置保留。"),
        buttons: [tr("取消"), tr("清空历史")],
        defaultId: 0,
        cancelId: 0,
      });
      if (r.response !== 1) return false;
      await request("clear");
      notifyUI();
      return true;
    });
    handle("pickExecutable", async () => {
      const r = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [{ name: "Codex executable", extensions: ["exe"] }],
      });
      return r.canceled ? null : r.filePaths[0];
    });
    handle("openData", () => shell.openPath(data));
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
    widget = createWidget({ data, restore: restoreMain, refresh: refreshQuietly });
    if (widgetMode) widget.show();
    for (const [name, fn] of Object.entries({ snapshot: () => request("widget"), restore: restoreMain,
      menu: () => widget.menu(), anchor: () => widget.anchor(), hover: hit => widget.hover(hit), drag: payload => widget.drag(payload), refresh: () => request("refresh") })) {
      handle(`widget:${name}`, fn, widget.window.webContents);
    }
    request("snapshot", {})
      .then((s) => applySettings(s.settings))
      .catch(() => {});
  });
  let databaseClosed=false,pendingShutdown=false;
  app.on("before-quit", (event) => {
    if(databaseClosed||!worker)return;
    event.preventDefault();
    if(pendingShutdown)return;
    quitting = true;
    // Dispose the transparent surface before Electron starts closing native windows.
    // Its renderer must not keep queuing snapshots while the database shuts down.
    if (widget && !widget.window.isDestroyed()) widget.window.destroy();
    stopQueries();
    pendingShutdown=true;
    worker.shutdown().catch(()=>{}).finally(()=>{databaseClosed=true;app.quit();});
  });
  app.on("window-all-closed", () => {});
}
