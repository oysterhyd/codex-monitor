const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const go = require('./go.cjs');
function copyTree(source, destination) { fs.mkdirSync(destination,{recursive:true}); for (const entry of fs.readdirSync(source,{withFileTypes:true})) { const from=path.join(source,entry.name), to=path.join(destination,entry.name); if(entry.isDirectory()) copyTree(from,to); else if(entry.isFile()) fs.copyFileSync(from,to); } }
const task = process.argv[2] || 'start';
const out = path.join(root, 'build', 'native');
const exe = path.join(out, 'Codex Monitor Native.exe');
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (task === 'test') { run(go, ['test', './...']); process.exit(0); }
if (!['build', 'start'].includes(task)) throw new Error(`Unknown task: ${task}`);
run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
fs.mkdirSync(out, { recursive: true });
run(go, ['build', '-trimpath', '-ldflags=-s -w -H=windowsgui', '-o', exe, '.']);
fs.copyFileSync(path.join(root, 'assets', 'icon.ico'), path.join(out, 'icon.ico'));
const widget = path.join(out, 'widget');
copyTree(path.join(root, 'dist'), path.join(widget, 'dist'));
fs.mkdirSync(path.join(widget,'assets'),{recursive:true});
for(const name of ['icon.png','monitor-glass.png'])fs.copyFileSync(path.join(root,'assets',name),path.join(widget,'assets',name));
const widgetSources=['native-widget.cjs','widget-window.cjs','widget-preload.cjs'];
const widgetElectron=path.join(widget,'electron');fs.mkdirSync(widgetElectron,{recursive:true});
for(const name of widgetSources)fs.copyFileSync(path.join(root,'electron',name),path.join(widgetElectron,name));
copyTree(path.join(root, 'node_modules', 'electron', 'dist'), path.join(widget, 'runtime'));
console.log(`Native application: ${exe}`);
if (task === 'start') run(exe, process.argv.slice(3));
