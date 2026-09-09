const { BrowserWindow, screen, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

function createWidget({ data, restore, refresh }) {
  const file = path.join(data, 'widget-window.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const width = 360, height = 260;
  const position = () => {
    const area = Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea : screen.getPrimaryDisplay().workArea;
    return { x: Math.round(Math.max(area.x, Math.min(saved.x ?? area.x + area.width - width - 24, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(saved.y ?? area.y + 48, area.y + area.height - height))) };
  };
  const window = new BrowserWindow({ ...position(), width, height, frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: false, resizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, show: false, alwaysOnTop: saved.topmost !== false, title: 'Codex Monitor Widget',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'widget-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window.removeMenu();
  window.on('page-title-updated', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  const persist = () => {
    saved = { ...window.getBounds(), topmost: window.isAlwaysOnTop(), mode: saved.mode === true };
    try { fs.writeFileSync(file, JSON.stringify(saved)); } catch {}
  };
  window.on('moved', persist);
  const enter = () => { window.setPosition(position().x, position().y); window.showInactive(); window.setSkipTaskbar(false); window.webContents.send('widget:enter'); };
  let ready = false, wanted = false;
  // ready-to-show can be permanently cancelled when the window is hidden while its
  // first paint is still pending (transparent windows during startup), so treat
  // did-finish-load as an equally valid readiness signal.
  const markReady = () => { if (ready) return; ready = true; if (wanted) enter(); };
  window.once('ready-to-show', markReady);
  window.webContents.once('did-finish-load', markReady);
  const show = () => { saved.mode = true; wanted = true; persist(); if (ready) enter(); };
  const hide = (animate = true) => {
    saved.mode = false; wanted = false; persist();
    window.setSkipTaskbar(true);
    if (!animate || !ready || !window.isVisible()) { window.hide(); return; }
    window.webContents.send('widget:exit');
    setTimeout(() => { if (!window.isDestroyed() && !wanted) window.hide(); }, 240);
  };
  window.on('close', event => { event.preventDefault(); hide(); });
  const reposition = () => { if (window.isVisible()) window.setPosition(position().x, position().y); };
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
  window.on('closed', () => { screen.removeListener('display-removed', reposition); screen.removeListener('display-metrics-changed', reposition); });
  window.loadFile(path.join(__dirname, '../dist/index.html'), { query: { widget: '1' } });
  return { window, show, hide, menu() {
    Menu.buildFromTemplate([
      { label: '打开主窗口 / Open monitor', click: restore },
      { label: '置顶 / Always on top', type: 'checkbox', checked: window.isAlwaysOnTop(), click: item => { window.setAlwaysOnTop(item.checked); persist(); } },
      { label: '刷新数据 / Refresh', click: refresh },
      { type: 'separator' },
      { label: '隐藏小组件 / Hide widget', click: () => hide() },
    ]).popup({ window });
  } };
}
module.exports = { createWidget };
