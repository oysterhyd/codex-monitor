const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const go = require('./go.cjs');
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
// Only remove known generated output, inside this workspace's build directory.
if (!out.startsWith(path.join(root, 'build') + path.sep)) throw new Error('Invalid build output path');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
run(go, ['build', '-trimpath', '-ldflags=-s -w -H=windowsgui', '-o', exe, '.']);
fs.copyFileSync(path.join(root, 'assets', 'icon.ico'), path.join(out, 'icon.ico'));
console.log(`Native application: ${exe}`);
if (task === 'start') run(exe, process.argv.slice(3));
