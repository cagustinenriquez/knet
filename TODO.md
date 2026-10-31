# TODO

## Snap (Linux)

- [x] **Top-bar icon shows "⋯" instead of the k icon.** (Verified fixed 2026-10-31.) It's the *tray* icon: Electron writes
  the tray image to `$TMPDIR/org.chromium.Chromium.*/status_icon_0.png` and the shell reads
  it, but a snap's /tmp is private, so the shell can't. Fix: snap environment
  `TMPDIR=$XDG_RUNTIME_DIR` (package.json) + a fallback in main.js. (Also fixed: `StartupWMClass=oknetwork` to match the window's WM_CLASS.)
- [ ] Harmless GTK warnings in the terminal (`'font-feature-settings' is not a valid property
  name`): the snap's bundled GTK (gnome-3-28 runtime) is older than the host Yaru theme.
  Goes away with the move to core24 below.
- [ ] Move the snap to electron-builder's **core24** build (`snapcraft.core24`, currently
  beta). It bundles current GNOME/GTK/Mesa, so we could drop the workarounds:
  software rendering (`app.disableHardwareAcceleration()` in a snap), forced X11
  (`--ozone-platform=x11`, `allowNativeWayland: false`) and `LIBGL_DEBUG=quiet`.
  Needs snapcraft with LXD or Multipass to build.
- [ ] Before stable: bump `version` in package.json, fill in PRIVACY.md placeholders,
  add store screenshots, release from edge → stable.

## macOS

- [ ] Test on a real Mac (Apple Silicon and Intel): window buttons over the sidebar, dragging
  the window by the top strip, menu-bar icon in light and dark mode, notifications, ⌘Q.
- [ ] Apple Developer Program ($99/year) → "Developer ID Application" certificate and an
  app-specific password → add the secrets from `.github/workflows/release.yml` so releases
  are signed and notarized (no "Open Anyway" step).
- [ ] Mac App Store (optional, later): `mas` target, App Sandbox entitlements, provisioning
  profile, App Store Connect listing with the privacy policy.
- [ ] Local Mac testing with **Docker-OSX** (`sickcodes/docker-osx`): macOS in a VM inside
  Docker. This machine can run it (KVM, 12 GB RAM, ~390 GB free disk).
  - Tests the **Intel (x64) build only**: the Apple Silicon DMG needs a real Mac.
  - Use **Ventura** (the app needs macOS 12+; Docker-OSX's ready-made "auto" image is
    Catalina 10.15, too old). First run installs macOS from recovery (~1 hour, by hand).
  - Ryzen CPU: use the Intel CPU-model flags below; AMD can be finicky, Ventura is safest.
  - Slow (no GPU), fine for layout / menu-bar icon / notifications / ⌘Q.
  - Apple's license only allows macOS VMs on Apple hardware: personal testing only.
  ```bash
  xhost +local:docker          # let the container open a window
  docker run -it --device /dev/kvm -p 50922:10022 \
    -v /tmp/.X11-unix:/tmp/.X11-unix -e DISPLAY=$DISPLAY \
    -e SHORTNAME=ventura -e RAM=6 -e GENERATE_UNIQUE=true \
    -e CPU='Haswell-noTSX' -e CPUID_FLAGS='kvm=on,vendor=GenuineIntel,+invtsc,vmware-cpuid-freq=on' \
    sickcodes/docker-osx:latest
  ```
  Get the app in: `cd dist && python3 -m http.server` on the PC, then in Safari inside the
  VM open `http://10.0.2.2:8000` and download `OkNetwork-<version>-x64.dmg`.
- [ ] Mac layout preview on Linux: a dev switch like `KNET_PLATFORM=darwin npm start` that
  turns on the macOS styling (space for the window buttons, drag strip).
- [ ] Release workflow: after the Mac build, install the DMG on the GitHub macOS runner,
  launch the app and upload screenshots as an artifact (smoke test on a real Mac).

## Windows

- [ ] Test the installer on Windows 11 (free evaluation VM from Microsoft, e.g. in GNOME
  Boxes or VirtualBox): install, Start menu shortcut, notifications, tray icon (right-click
  menu, closing the window keeps alerts running), uninstall keeps `%APPDATA%\knet`.
- [ ] Remove the SmartScreen warning: **Microsoft Store** (free individual developer account;
  the Store signs the app; electron-builder `appx` target + Partner Center identity) or Azure
  Trusted Signing (~$10/month) with `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets.

## Store listing assets

- [ ] Snap Store listing icon: the store accepts 40×40 to 512×512, so `build/icon.png`
  (1024) is rejected. Upload **`build/icon-512.png`** (made by `npm run icons`) at
  snapcraft.io/oknetwork/listing.
- [ ] Snap Store listing page (snapcraft.io/oknetwork/listing): pick categories
  **Productivity** (primary) and **Utilities**, add screenshots, contact and website. The
  store search uses the title, summary and description from package.json (`build.snap`).
