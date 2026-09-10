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
  window.on('moved', () => { if (!drag) persist(); });
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
    if (!payload || !['start', 'move', 'end', 'cancel'].includes(payload.phase)) return false;
    // Use OS cursor coordinates in the same DIP space as bounds; the drag target
    // is anchored to the grab offset (cursor - window origin) captured at start,
    // so the ball stays glued to the pointer and clamped moves self-heal.
    const cursor = screen.getCursorScreenPoint();
    if (payload.phase === 'start') {
      const bounds = window.getBounds();
      drag = { x0: cursor.x, y0: cursor.y, grabX: cursor.x - bounds.x, grabY: cursor.y - bounds.y, moved: false };
      return false;
    }
    if (!drag) return false;
    if (payload.phase !== 'cancel') {
      drag.moved ||= Math.hypot(cursor.x - drag.x0, cursor.y - drag.y0) > 5;
      if (drag.moved) {
        const x = Math.round(cursor.x - drag.grabX), y = Math.round(cursor.y - drag.grabY);
        const area = screen.getDisplayNearestPoint(cursor).workArea;
        // Keep a 48px handle of the glass visible instead of pinning the whole
        // window inside the work area, so edge drags never fight the cursor.
        window.setPosition(Math.max(area.x - currentWidth + 48, Math.min(x, area.x + area.width - 48)),
          Math.max(area.y - currentHeight + 48, Math.min(y, area.y + area.height - 48)));
      }
    }
    const moved = drag.moved;
    if (payload.phase === 'end' || payload.phase === 'cancel') { drag = null; persist(); }
    return moved;
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
