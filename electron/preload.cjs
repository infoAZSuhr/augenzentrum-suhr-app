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
  // Brief-HTML -> PDF-Buffer rendern (kein Disk-Schreiben). Fuer Postausgang.
  renderBriefPdf: (html) => ipcRenderer.invoke('render-brief-pdf', html),
  // Postausgang: PDF aus Blob in tmp ablegen / Drag starten / Mail oeffnen / loeschen
  writePdfTmp: (buf, filename) => ipcRenderer.invoke('write-pdf-tmp', buf, filename),
  deletePdfTmp: (filePath) => ipcRenderer.invoke('delete-pdf-tmp', filePath),
  startPdfDrag: (filePath) => { ipcRenderer.send('start-pdf-drag', filePath); return Promise.resolve({ ok: true }) },
  openMailWithAttachments: (filePaths, subject) => ipcRenderer.invoke('open-mail-with-attachments', filePaths, subject),
  // PDF via CDP direkt ins Liris-Webview-Upload-Feld setzen
  uploadPdfToLiris: (webContentsId, filePath) => ipcRenderer.invoke('upload-pdf-to-liris', webContentsId, filePath),
  // Subscribe to updater status events. Callback bekommt
  //   { state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error', ...payload }
  // Liefert unsubscribe-Funktion.
  onUpdateProgress: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('updater-status', handler)
    return () => ipcRenderer.removeListener('updater-status', handler)
  },
})
