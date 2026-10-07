const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const readline = require('node:readline');
const { randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'widget-acceptance');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-widget-acceptance-'));
const go = require('./go.cjs');
function run(args) {
  const r = spawnSync(go, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, args.join(' '));
}
(async () => {
  let app, backend, socket;
  const server = net.createServer();
  try {
    fs.mkdirSync(out, {recursive:true});
    run(['run', './cmd/fixture', profile]);
    const exe = path.join(out, 'widget-backend.exe');
    run(['build', '-trimpath', '-o', exe, '.']);
    backend = spawn(exe, ['--stdio','--offline','--data',profile,'--home',profile], {cwd:root,windowsHide:true,stdio:['pipe','pipe','inherit']});
    const output = readline.createInterface({input:backend.stdout});
    output.on('line', line => socket?.write(line+'\n'));
    let restored = 0;
    const token = randomBytes(32).toString('hex');
    server.on('connection', connection => {
      socket = connection;
      const input = readline.createInterface({input:connection});
      let authenticated = false;
      input.on('line', line => {
        const message = JSON.parse(line);
        if (!authenticated) { assert.equal(message.token,token); authenticated=true; return; }
        if (message.id) backend.stdin.write(line+'\n');
        if (message.event === 'restore') { restored++; socket.write(JSON.stringify({event:'hide'})+'\n'); }
      });
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const config = JSON.stringify({data:profile,port:server.address().port,token});
    const widgetEnv = {...process.env};
    delete widgetEnv.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({executablePath:require('electron'),args:[path.join(root,'electron','native-widget.cjs'),config],env:widgetEnv});
    const widget = await app.firstWindow();
    widget.setDefaultTimeout(15000);
    const errors = []; widget.on('pageerror', e => errors.push(e.message));
    try { await widget.locator('.widget-in .widget-metric').first().waitFor(); }
    catch (error) { console.error(await widget.evaluate(() => ({url:location.href,html:document.body.innerHTML.slice(0,1500),bridge:!!window.widget})),errors); throw error; }
    await widget.waitForFunction(() => document.querySelector('.widget-today strong').textContent !== '—');
    await widget.waitForFunction(() => Math.abs(document.querySelector('.widget-content').getBoundingClientRect().width-536)<.5);
    const first = await widget.evaluate(() => window.widget.snapshot());
    assert.equal(first.usageScope,'all');
    assert.equal(first.account,'native-account-a');
    assert.equal(await widget.evaluate(() => !!window.monitor),false);
    assert.equal(await widget.evaluate(() => document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight),false);
    assert.equal(await widget.locator('.widget-content').evaluate(el => Math.round(el.getBoundingClientRect().width)),536);
    const bounds = () => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getBounds());
    const initial = await bounds();
    assert.equal(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()),true);
    await widget.screenshot({path:path.join(out,'card.png')});
    await widget.getByRole('button',{name:'收起为 Token 圆球'}).click();
    await widget.waitForTimeout(160);
    const width = await widget.locator('.desktop-widget').evaluate(el => el.getBoundingClientRect().width);
    const reduced = await widget.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!reduced) assert.ok(width>120 && width<536, `intermediate morph width ${width}`);
    await widget.waitForTimeout(650);
    assert.deepEqual(await bounds(),initial,'morph keeps fixed native bounds');
    assert.equal(await widget.getByRole('button',{name:'收起为 Token 圆球'}).count(),0,'collapsed controls are inert');
    await widget.screenshot({path:path.join(out,'orb.png')});
    // Drive the renderer's actual drag bridge; window movement must follow client displacement.
    await widget.evaluate(() => window.widget.drag({phase:'start',clientX:488,clientY:72}));
    await widget.evaluate(() => window.widget.drag({phase:'move',clientX:448,clientY:92}));
    await widget.evaluate(() => window.widget.drag({phase:'end',clientX:488,clientY:72}));
    const moved = await bounds();
    assert.ok(Math.abs(moved.x-(initial.x-40))<=2 && Math.abs(moved.y-(initial.y+20))<=2,JSON.stringify({initial,moved}));
    assert.equal(await widget.locator('.desktop-widget').evaluate(el => el.classList.contains('is-orb')),true);
    await widget.locator('.widget-orb').press('Enter');
    await widget.waitForTimeout(800);
    assert.equal(await widget.locator('.desktop-widget').evaluate(el => Math.round(el.getBoundingClientRect().width)),536);
    await widget.emulateMedia({reducedMotion:'reduce'});
    await widget.getByRole('button',{name:'收起为 Token 圆球'}).click();
    await widget.waitForTimeout(100);
    await widget.locator('.widget-orb').press('Enter');
    await widget.waitForTimeout(100);
    assert.equal(await widget.locator('.desktop-widget').evaluate(el => el.classList.contains('is-orb')),false);
    // UI error/expiry examples are test-only IPC responses; production data above comes from Go.
    await app.evaluate(({ipcMain},sample) => {
      ipcMain.removeHandler('widget:snapshot');
      ipcMain.handle('widget:snapshot',() => ({...sample,language:'en',quotaStatus:{ok:false},quotas:sample.quotas.map(q=>({...q,resets:1}))}));
    },first);
    socket.write(JSON.stringify({event:'update'})+'\n');
    await widget.locator('.widget-metric[title^="Awaiting reset"]').first().waitFor();
    await widget.screenshot({path:path.join(out,'english-expired.png')});
    await app.evaluate(({ipcMain}) => { ipcMain.removeHandler('widget:snapshot'); ipcMain.handle('widget:snapshot',() => {throw Error('test disconnected')}); });
    socket.write(JSON.stringify({event:'update'})+'\n');
    await widget.getByText('Disconnected · retrying').waitFor();
    await widget.getByRole('button',{name:'Open monitor'}).click();
    await widget.waitForTimeout(200);
    assert.equal(restored,1,'restore reaches the native-parent transport');
    assert.equal(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isVisible()),false);
    assert.deepEqual(errors,[]);
    const state = JSON.parse(fs.readFileSync(path.join(profile,'widget-window.json'),'utf8'));
    assert.equal(state.mode,false); assert.equal(state.topmost,true);
    console.log('Widget acceptance passed: Go data, card/orb motion, drag, reduced motion, English, expiry, retry, restore and state persistence.');
  } finally {
    socket?.write(JSON.stringify({event:'close'})+'\n');
    if (app) await app.close();
    socket?.destroy(); server.close();
    if (backend) {
      backend.stdin.end();
      if (backend.exitCode===null) await new Promise(resolve=>backend.once('exit',resolve));
    }
    const helper = path.join(out,'widget-backend.exe');
    if (fs.existsSync(helper)) fs.unlinkSync(helper);
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:15,retryDelay:100});
  }
})().catch(error => {console.error(error);process.exitCode=1});
