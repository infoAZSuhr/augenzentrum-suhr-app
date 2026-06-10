// Preload script - runs in renderer context with limited Node.js access
const { contextBridge, ipcRenderer } = require('electron')

// Version vom Main-Process via synchronem IPC holen.
// Robuster als require('../package.json') — das kann in der gepackten
// asar-App in seltenen Faellen scheitern. app.getVersion() im Main-Process
// liest die Version aus dem Build-Metadata und ist immer korrekt.
let resolvedVersion = '1.0.0'
try {
  const v = ipcRenderer.sendSync('app-version-sync')
  if (typeof v === 'string' && v) resolvedVersion = v
} catch { /* fallback bleibt */ }

contextBridge.exposeInMainWorld('electronApp', {
  platform: process.platform,
  version: resolvedVersion,
  // Open a .ics file directly in the default calendar app (Outlook)
  openIcs: (content, filename) => ipcRenderer.invoke('open-ics', content, filename),
  // Open Liris in a separate (non-focus-stealing) window with the given PID
  openLiris: (pid) => ipcRenderer.invoke('open-liris', pid),
  // Brief-HTML -> PDF in Downloads schreiben + Explorer oeffnen
  saveBriefPdf: (html, filename) => ipcRenderer.invoke('save-brief-pdf', html, filename),
  // Subscribe to updater status events. Callback bekommt
  //   { state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error', ...payload }
  // Liefert unsubscribe-Funktion.
  onUpdateProgress: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('updater-status', handler)
    return () => ipcRenderer.removeListener('updater-status', handler)
  },
})
