// Renders assets/icon.svg to the PNGs the app and installers use. Run with Electron:
//   npx electron scripts/render-icons.js
// → build/icon.png (1024, installers/stores), assets/icon.png (256, window/tray/notifications)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(1);
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  const frame = new Promise((resolve) => win.webContents.on('paint', (_e, _d, img) => resolve(img)));
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const img = await frame;
  const big = img.getSize().width === 1024 ? img : img.resize({ width: 1024, height: 1024, quality: 'best' });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), big.toPNG());
  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), big.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
  console.log('wrote build/icon.png (1024) and assets/icon.png (256)');
  app.exit(0);
});
