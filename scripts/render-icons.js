// Renders the SVG icons to the PNGs the app and installers use. Run with Electron:
//   npm run icons
// assets/icon.svg         → build/icon.png (1024: installers, stores, macOS .icns)
//                           build/icon-512.png (512: Snap Store listing, max 512×512)
//                           assets/icon.png (256: window, tray on Linux/Windows, notifications)
// assets/trayTemplate.svg → assets/trayTemplate.png (16) + @2x (32): macOS menu bar
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

async function render(svgFile, transform = (x) => x) {
  const svg = transform(fs.readFileSync(path.join(root, 'assets', svgFile), 'utf8'));
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(1);
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  // Use the first frame with something drawn in it (the first can be blank), and copy it:
  // a paint frame's pixels go away with its window.
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const img = await new Promise((resolve) => {
    win.webContents.on('paint', (_e, _d, frame) => {
      const px = frame.toBitmap();
      for (let i = 3; i < px.length; i += 4) if (px[i]) return resolve(nativeImage.createFromBuffer(frame.toPNG()));
    });
    win.webContents.invalidate();
  });
  win.destroy();
  return img.getSize().width === 1024 ? img : img.resize({ width: 1024, height: 1024, quality: 'best' });
}

// macOS template images must be pure black + alpha; force it (antialiased edges can pick up color).
function toBlack(img) {
  const { width, height } = img.getSize();
  const px = img.toBitmap();
  for (let i = 0; i < px.length; i += 4) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; }
  return nativeImage.createFromBitmap(px, { width, height });
}

const write = (rel, img) => { fs.writeFileSync(path.join(root, rel), img.toPNG()); console.log('wrote', rel, img.getSize().width); };

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // keep running between renders
app.whenReady().then(async () => {
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  const icon = await render('icon.svg');
  write('build/icon.png', icon);
  write('build/icon-512.png', icon.resize({ width: 512, height: 512, quality: 'best' }));
  write('assets/icon.png', icon.resize({ width: 256, height: 256, quality: 'best' }));
  const tray = toBlack(await render('trayTemplate.svg'));
  write('assets/trayTemplate.png', tray.resize({ width: 16, height: 16, quality: 'best' }));
  write('assets/trayTemplate@2x.png', tray.resize({ width: 32, height: 32, quality: 'best' }));
  app.exit(0);
});
