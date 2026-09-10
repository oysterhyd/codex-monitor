const { BrowserWindow, screen, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const CARD_W = 560, CARD_H = 380;
// The orb lives in the window's top-right corner: local rect (428..548, 12..132)
// inside the fixed 560x380 window. The glass shares that right edge when expanded.
const ORB = { l: CARD_W - 132, r: CARD_W - 12, t: 12, b: 132 };

function createWidget({ data, restore, refresh }) {
  const file = path.join(data, 'widget-window.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let drag = null;
  const clampOrb = (x, y, area) => ({
    // Keep a 48px grab handle of the orb visible; the (transparent) window may
    // extend past the screen edge so edge drags never fight the pointer.
    x: Math.round(Math.max(area.x - ORB.r + 48, Math.min(x, area.x + area.width - ORB.l - 48))),
    y: Math.round(Math.max(area.y - ORB.b + 48, Math.min(y, area.y + area.height - ORB.t - 48))),
  });
  const position = () => {
    const area = Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea : screen.getPrimaryDisplay().workArea;
    return clampOrb(saved.x ?? area.x + area.width - CARD_W - 24, saved.y ?? area.y + 48, area);
  };
  const window = new BrowserWindow({ ...position(), width: CARD_W, height: CARD_H, frame: false, transparent: true,
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
  const enter = () => {
    const p = position();
    window.setBounds({ ...p, width: CARD_W, height: CARD_H });
    window.showInactive();
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setSkipTaskbar(false);
    window.webContents.send('widget:enter');
  };
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
    window.setIgnoreMouseEvents(false);
    window.setSkipTaskbar(true);
    if (!animate || !ready || !window.isVisible()) { window.hide(); return; }
    window.webContents.send('widget:exit');
    setTimeout(() => { if (!window.isDestroyed() && !wanted) window.hide(); }, 240);
  };
  window.on('close', event => { event.preventDefault(); hide(); });
  window.on('moved', () => { if (!drag) persist(); });
  // Windows re-rounds transparent-window bounds on DPI-virtualized moves (the
  // width can ratchet by a few px). Snap back to the design size whenever it drifts.
  window.on('resize', () => {
    const [w, h] = window.getSize();
    if ((w !== CARD_W || h !== CARD_H) && !drag) window.setSize(CARD_W, CARD_H);
  });
  const reposition = () => { if (window.isVisible()) window.setBounds({ ...position(), width: CARD_W, height: CARD_H }); };
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
  window.on('closed', () => { screen.removeListener('display-removed', reposition); screen.removeListener('display-metrics-changed', reposition); });
  window.loadFile(path.join(__dirname, '../dist/index.html'), { query: { widget: '1' } });
  return { window, show, hide, hover(hit) {
    if (drag) return;
    window.setIgnoreMouseEvents(hit !== true, { forward: hit !== true });
  }, drag(payload) {
    if (!payload || !['start', 'move', 'end', 'cancel'].includes(payload.phase)) return false;
    // Drag math uses renderer client deltas only. The identity client = screen -
    // window-origin makes `bounds + (client - grabClient)` exact: window motion
    // cancels out, so neither window-locked cursor reads nor screenX drift apply.
    if (payload.phase === 'start') {
      drag = { cx: payload.clientX, cy: payload.clientY, moved: false };
      window.setIgnoreMouseEvents(false);
      return false;
    }
    if (!drag) return false;
    if (payload.phase !== 'cancel' && typeof payload.clientX === 'number') {
      drag.moved ||= Math.hypot(payload.clientX - drag.cx, payload.clientY - drag.cy) > 5;
      if (drag.moved) {
        const bounds = window.getBounds();
        const x = Math.round(bounds.x + payload.clientX - drag.cx);
        const y = Math.round(bounds.y + payload.clientY - drag.cy);
        const area = screen.getDisplayNearestPoint({ x, y }).workArea;
        const c = clampOrb(x, y, area);
        // Move and pin the size together: Windows re-rounds transparent-window
        // bounds on every SetWindowPos, which would otherwise ratchet the width.
        window.setBounds({ x: c.x, y: c.y, width: CARD_W, height: CARD_H });
      }
    }
    const moved = drag.moved;
    if (payload.phase === 'end' || payload.phase === 'cancel') { drag = null; persist(); }
    return moved;
  }, anchor() {
    // Re-fit the fixed window so the expanded card is fully on screen; used before
    // the expand morph when the orb was parked near a screen edge.
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const x = Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - CARD_W)));
    const y = Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - CARD_H)));
    if (x !== bounds.x || y !== bounds.y) window.setBounds({ x, y, width: CARD_W, height: CARD_H });
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
