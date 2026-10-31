// Runs the end-to-end tests in e2e/ with Electron, one after another.
// --manual: show real notifications and wait for you to click them (sets E2E_MANUAL=1).
// (VS Code's terminal sets ELECTRON_RUN_AS_NODE=1, which breaks Electron; it's cleared here.)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron'); // resolves to the binary path

const dir = path.join(__dirname, '..', 'e2e');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--manual')) env.E2E_MANUAL = '1';
let failed = 0;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.e2e.js')).sort()) {
  const r = spawnSync(electron, [path.join(dir, file)], { stdio: 'inherit', env, timeout: 120000 });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
