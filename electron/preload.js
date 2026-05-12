// Preload script - runs in renderer context with limited Node.js access
// Firebase SDK kommuniziert direkt über HTTPS, kein Node.js-Zugriff nötig
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronApp', {
  platform: process.platform,
  version: process.env.npm_package_version || '1.0.0',
})
