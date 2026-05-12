// Preload script - runs in renderer context with limited Node.js access
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronApp', {
  platform: process.platform,
  version: process.env.npm_package_version || '1.0.0',
  // Open a .ics file directly in the default calendar app (Outlook)
  openIcs: (content, filename) => ipcRenderer.invoke('open-ics', content, filename),
})
