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
const { createWidget } = require("./widget-window.cjs");
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
  function trayMenu() {
    tray.setToolTip(tr("Codex Monitor · 本机用量监测"));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: tr("打开 Codex Monitor"), click: restoreMain },
        { label: "桌面小组件 / Desktop widget", type: "checkbox", checked: widgetMode, click: item => setWidgetMode(item.checked) },
        { label: tr("刷新额度"), click: () => request("refresh").catch(() => {}) },
        {
          label: tr("静音提醒"),
          type: "checkbox",
          checked: !!settings.muted,
          click: async (item) => {
            settings = await request("settings", { muted: item.checked }).catch(()=>settings);
            notifyUI();
            trayMenu();
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
    try { widgetMode = JSON.parse(fs.readFileSync(path.join(data, "widget-window.json"), "utf8")).mode === true; } catch {}
    worker = new WorkerManager(path.join(__dirname, "worker.cjs"), {
        db: path.join(data, "monitor.sqlite"),
        home:
          process.env.MONITOR_CODEX_HOME ||
          process.env.CODEX_HOME ||
          path.join(os.homedir(), ".codex"),
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
                    icon: path.join(__dirname, "../assets/icon.png"),
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
      icon: path.join(__dirname, "../assets/icon.png"),
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
    tray = new Tray(path.join(__dirname, "../assets/icon.png"));
    tray.setToolTip(tr("Codex Monitor · 本机用量监测"));
    tray.on("double-click", restoreMain);
    trayMenu();
    const handle = (name, fn) =>
      ipcMain.handle(name, (event, arg) => {
        if (event.sender !== win.webContents) throw new Error(tr("无效来源"));
        return fn(arg);
      });
    handle("snapshot", async (filter) => {
      const s = await request("snapshot", filter || {});
      settings = s.settings;
      return {
        ...s,
        paths: {
          data,
          home:
            process.env.MONITOR_CODEX_HOME ||
            process.env.CODEX_HOME ||
            path.join(os.homedir(), ".codex"),
        },
        version: app.getVersion(),
      };
    });
    handle("refresh", () => request("refresh"));
    handle("settings", async (value) => {
      settings = await request("settings", value);
      nativeTheme.themeSource = settings.theme;
      if (!smoke && typeof value.autoStart === "boolean")
        app.setLoginItemSettings({
          openAtLogin: settings.autoStart,
          path: app.getPath("exe"),
          args: ["--hidden"],
        });
      trayMenu();
      notifyUI();
      return settings;
    });
    handle("account", value => request("account", value));
    handle("widgetMode", (on) => { if (typeof on === 'boolean') setWidgetMode(on); return widgetMode; });
    handle("assignAccount", async value => {
      const result = await dialog.showMessageBox(win, { type: "question", title: tr("历史账号归属"), message: value.turn ? tr("将此任务的全部用量记录归属到所选账号？此操作不修改额度快照。") : tr("将当前时间范围内全部未归属记录指定给所选账号？"), buttons: [tr("取消"), tr("确认归属")], defaultId: 0, cancelId: 0 });
      return result.response === 1 ? request("assignAccount", value) : null;
    });
    handle("price", (value) => request("price", value));
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
          tr("Codex 原始文件不会被修改。仅继续采集此刻之后的数据；已有历史不会自动重新导入。价格和设置保留。"),
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
    widget = createWidget({ data, restore: restoreMain, refresh: () => request("refresh").catch(() => {}) });
    if (widgetMode) widget.show();
    for (const [name, fn] of Object.entries({ snapshot: () => request("widget"), restore: restoreMain,
      menu: () => widget.menu(), anchor: () => widget.anchor(), hover: hit => widget.hover(hit), drag: payload => widget.drag(payload), refresh: () => request("refresh") })) {
      ipcMain.handle(`widget:${name}`, (event, arg) => {
        if (event.sender !== widget.window.webContents) throw new Error(tr("无效来源"));
        return fn(arg);
      });
    }
    request("snapshot", {})
      .then((s) => {
        settings = s.settings;
        nativeTheme.themeSource = settings.theme;
        trayMenu();
        notifyUI();
      })
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
