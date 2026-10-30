// The only bridge between the UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('knet', {
  getState: () => ipcRenderer.invoke('get-state'),
  getJobs: () => ipcRenderer.invoke('get-jobs'),
  saveProfile: (p) => ipcRenderer.invoke('save-profile', p),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  setStatus: (id, status) => ipcRenderer.invoke('set-status', id, status),
  syncNow: () => ipcRenderer.invoke('sync-now'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  testNotification: () => ipcRenderer.invoke('test-notification'),
  on: (channel, fn) => {
    if (!['jobs-updated', 'sync-status', 'focus-job'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => fn(payload));
  },
});
