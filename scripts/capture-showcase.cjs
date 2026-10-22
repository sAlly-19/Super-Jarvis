const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');

const cleanEnv = Object.assign({}, process.env);
delete cleanEnv.ELECTRON_RUN_AS_NODE;
cleanEnv.SCREENSHOT_OUT_DIR = path.resolve(__dirname, '..', 'assets', 'screenshots');

console.log('[capture-showcase] Launching Electron with --capture-showcase...');
const child = spawn(electron, ['.', '--capture-showcase'], {
  env: cleanEnv,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  console.log('[capture-showcase] Electron finished with code', code);
  process.exit(code ?? 0);
});
