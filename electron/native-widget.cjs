// Transparent widget host for the MyGO application.
// All data requests go to the native parent's single backend; no DB is opened here.
const { app, ipcMain } = require('electron');
const readline = require('node:readline');
const net = require('node:net');
const { createWidget } = require('./widget-window.cjs');
const config = JSON.parse(process.argv.at(-1));
app.setPath('userData', config.data);
let widget, counter = 0, quitting = false, connected = false, wanted = true;
const pending = new Map();
const transport = net.createConnection({host:'127.0.0.1',port:config.port});
const output = [];
const send = message => { const line=JSON.stringify(message)+'\n'; if(connected)transport.write(line);else output.push(line); };
transport.on('connect',()=>{transport.write(JSON.stringify({token:config.token})+'\n');connected=true;for(const line of output)transport.write(line);output.length=0;});
transport.on('error',()=>{quitting=true;widget?.window.destroy();app.quit();});
const request = (method, args) => new Promise((resolve, reject) => {
  const id = ++counter;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('采集服务暂不可用')); }, 120000);
  pending.set(id, { resolve, reject, timer }); send({ id, method, args });
});
const input = readline.createInterface({ input: transport, crlfDelay: Infinity });
input.on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  if (message.id) {
    const p = pending.get(message.id); if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(message.error)) : p.resolve(message.result); }
  } else if (message.event === 'close') { quitting = true; widget?.window.destroy(); app.quit(); }
  else if (message.event === 'show') {wanted=true;widget?.show();}
  else if (message.event === 'hide') {wanted=false;widget?.hide(false);}
  else if (message.event === 'update' && widget && !widget.window.isDestroyed()) widget.window.webContents.send('update');
});
input.on('close', () => { quitting = true; widget?.window.destroy(); app.quit(); });
app.whenReady().then(() => {
  widget = createWidget({ data: config.data, restore: () => send({ event: 'restore' }), refresh: () => request('refresh').catch(() => {}) });
  widget.window.webContents.on('did-fail-load', (_event, code) => send({event:'error',code:'widget_load',detail:code}));
  widget.window.webContents.on('preload-error', () => send({event:'error',code:'widget_preload'}));
  widget.window.webContents.on('render-process-gone', (_event, detail) => send({event:'error',code:'widget_renderer',reason:detail.reason}));
  if(config.diagnostics) widget.window.webContents.on('console-message', (...args) => send({event:'console',message:args[0]?.message || args[2]}));
  widget.window.on('hide', () => { if (!quitting) send({ event: 'hidden' }); });
  for (const [name, fn] of Object.entries({ snapshot: () => request('widget'), restore: () => send({ event: 'restore' }),
    menu: () => widget.menu(), anchor: () => widget.anchor(), hover: hit => widget.hover(hit), drag: value => widget.drag(value), refresh: () => request('refresh') })) {
    ipcMain.handle(`widget:${name}`, (event, arg) => { if (event.sender !== widget.window.webContents) throw new Error('无效来源'); return fn(arg); });
  }
  if(wanted)widget.show(); send({ event: 'ready' });
}).catch(() => { send({ event: 'error' }); quitting = true; app.quit(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
