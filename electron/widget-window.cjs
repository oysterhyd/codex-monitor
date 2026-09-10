const { BrowserWindow, screen, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

function createWidget({ data, restore, refresh }) {
  const file = path.join(data, 'widget-window.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const width = 560, height = 380;
  let currentWidth = width, currentHeight = height, drag = null;
  const position = () => {
    const area = Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea : screen.getPrimaryDisplay().workArea;
    return { x: Math.round(Math.max(area.x, Math.min(saved.x ?? area.x + area.width - currentWidth - 24, area.x + area.width - currentWidth))),
      y: Math.round(Math.max(area.y, Math.min(saved.y ?? area.y + 48, area.y + area.height - currentHeight))) };
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
  return { window, show, hide, resize(compact) {
    const size = compact === true ? 144 : width;
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const h = compact === true ? 144 : height;
    currentWidth = size; currentHeight = h;
    window.setBounds({ x: Math.max(area.x, Math.min(bounds.x + bounds.width - size, area.x + area.width - size)),
      y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - h)), width: size, height: h });
    persist();
  }, drag(payload) {
    if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
    if (payload.phase === 'start') { drag = { x: payload.x, y: payload.y, bounds: window.getBounds() }; return; }
    if (!drag) return;
    if (payload.phase === 'move') {
      const x = Math.round(drag.bounds.x + payload.x - drag.x), y = Math.round(drag.bounds.y + payload.y - drag.y);
      const area = screen.getDisplayNearestPoint({ x, y }).workArea;
      window.setPosition(Math.max(area.x, Math.min(x, area.x + area.width - currentWidth)),
        Math.max(area.y, Math.min(y, area.y + area.height - currentHeight)));
    }
    if (payload.phase === 'end') { drag = null; persist(); }
  }, menu() {
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
