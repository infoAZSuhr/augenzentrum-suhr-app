// Preload script - runs in renderer context with limited Node.js access
const { contextBridge, ipcRenderer } = require('electron')

// Version aus der gepackten app.asar holen — process.env.npm_package_version
// ist nur waehrend `npm run`-Aufrufen gesetzt, nicht in der installierten .exe.
// Fallback-Kette: package.json -> ipcRenderer (sync) -> hard '1.0.0'.
let resolvedVersion = '1.0.0'
try {
  const pkg = require('../package.json')
  if (pkg?.version) resolvedVersion = pkg.version
} catch { /* fallback bleibt */ }

contextBridge.exposeInMainWorld('electronApp', {
  platform: process.platform,
  version: resolvedVersion,
  // Open a .ics file directly in the default calendar app (Outlook)
  openIcs: (content, filename) => ipcRenderer.invoke('open-ics', content, filename),
  // Open Liris in a separate (non-focus-stealing) window with the given PID
  openLiris: (pid) => ipcRenderer.invoke('open-liris', pid),
})
