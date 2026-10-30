// Launches Electron. VS Code's terminal sets ELECTRON_RUN_AS_NODE=1, which makes
// Electron behave like plain Node and crash on startup, so we clear it here.
const { spawn } = require('child_process');
const electron = require('electron'); // resolves to the binary path

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: __dirname + '/..' });
child.on('exit', (code) => process.exit(code ?? 0));
