const fs = require('node:fs');
const path = require('node:path');
// Use the locally configured Go installation, falling back to PATH on other machines.
module.exports = process.env.GO_EXE || [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'go', 'bin', 'go.exe'),
  'go',
].find(file => file === 'go' || fs.existsSync(file));
