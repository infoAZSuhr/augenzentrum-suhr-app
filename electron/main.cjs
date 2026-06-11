const { app, BrowserWindow, shell, ipcMain, dialog, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Produktions-URL — die Electron-Huelle laedt die LIVE-Webseite, nicht die
// lokal gebundelte dist/. Dadurch werden alle Feature-Updates automatisch
// ausgespielt — sobald CI nach main pusht, sehen alle Praxis-PCs die neue
// Version beim naechsten App-Start. Die .exe muss nur dann neu verteilt
// werden, wenn sich main.cjs/preload.cjs/Electron-Version aendert
// (-> autoUpdater kuemmert sich darum, siehe unten).
const PROD_URL = 'https://azsdb-999d6.web.app'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Augenzentrum Suhr',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    show: false,
    backgroundColor: '#f9fafb',
    titleBarStyle: 'default',
  })

  // Show window once ready (avoids white flash)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Produktion: Live-URL laden. Fallback auf gebundeltes dist/, falls
    // kein Internet (z.B. erste Sekunden nach Start, oder Praxisnetz
    // hat kurz keine Verbindung).
    win.loadURL(PROD_URL).catch(err => {
      console.warn('[Electron] Konnte LIVE-URL nicht laden, lade Fallback:', err)
      win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(() => {})
    })
  }

  // Open external links in default browser, not in Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // DevTools-Shortcuts auch in der gepackten App: F12 und Strg+Shift+I
  // toggeln die Entwicklerwerkzeuge. Hilft bei Diagnose von Console-Fehlern
  // im Praxisbetrieb (sonst muesste der User die App neu installieren mit
  // Dev-Build).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const isF12 = input.key === 'F12'
    const isCtrlShiftI = input.control && input.shift && (input.key === 'I' || input.key === 'i')
    if (isF12 || isCtrlShiftI) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })
}

// ── Liris-Popup-Fenster (eigene BrowserWindow) ────────────────────────────
// Wird ueber den IPC-Channel 'open-liris-window' angetriggert. Eine einzige
// Fenster-Instanz wird wiederverwendet — beim zweiten Aufruf bekommt das
// bestehende Fenster nur die neue PID + wird fokussiert.
// Hauptfenster behaelt den Fokus auf "Patient bearbeiten", User kann Liris
// per Alt-Tab oder Klick auf die Taskbar holen.

const LIRIS_URL = 'https://vip.liris.ch/'
let lirisWindow = null

function openOrFocusLirisWindow(pid) {
  if (lirisWindow && !lirisWindow.isDestroyed()) {
    if (lirisWindow.isMinimized()) lirisWindow.restore()
    // Fenster wird nur gezeigt, aber NICHT in den Vordergrund geholt —
    // sonst stiehlt es dem Hauptfenster den Fokus, was wir vermeiden wollen.
    lirisWindow.showInactive()
    sendPidToLirisWindow(pid)
    return
  }

  lirisWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    title: 'Liris',
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:liris',     // Login bleibt erhalten
    },
  })

  lirisWindow.once('ready-to-show', () => {
    // showInactive = zeigen ohne Fokus zu stehlen -> User bleibt im Hauptfenster
    lirisWindow.showInactive()
    // Erste PID nach kurzer Verzoegerung uebertragen, sobald DOM bereit
  })

  lirisWindow.webContents.on('did-finish-load', () => {
    sendPidToLirisWindow(pid)
  })

  lirisWindow.on('closed', () => { lirisWindow = null })

  lirisWindow.loadURL(LIRIS_URL).catch(err =>
    console.warn('[Liris] loadURL fehlgeschlagen:', err?.message ?? err)
  )
}

function sendPidToLirisWindow(pid) {
  if (!lirisWindow || lirisWindow.isDestroyed()) return
  if (!pid) return
  const value = String(pid).startsWith('#') ? String(pid) : `#${pid}`
  // executeJavaScript direkt im Liris-Fenster — fuellt das Suchfeld,
  // drueckt Enter, klickt das erste Ergebnis. Gleiche Logik wie in der
  // alten LirisPage-Webview, nur jetzt im echten Fenster.
  const script = `
    (function() {
      var sel = 'input[placeholder^="Allgemeine Suche"]';
      var el = document.querySelector(sel);
      if (!el) return 'no-input-found';
      var proto = Object.getPrototypeOf(el);
      var setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.focus();
      ['keydown','keypress','keyup'].forEach(function(t) {
        el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      });
      setTimeout(function() {
        var candidates = ['[role="option"]','[role="listbox"] li','[role="listbox"] [role="option"]','ul.dropdown li','ul.search-results li','.search-result','.autocomplete-suggestion','.ui-menu-item','.MuiAutocomplete-option','.mat-option'];
        for (var i = 0; i < candidates.length; i++) {
          var hit = document.querySelector(candidates[i]);
          if (hit) { hit.click(); return; }
        }
        var still = document.querySelector(sel);
        if (still) {
          ['keydown','keypress','keyup'].forEach(function(t) {
            still.dispatchEvent(new KeyboardEvent(t, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          });
          still.blur();
          document.body.click();
        }
      }, 400);
      return 'ok';
    })();
  `
  // Kleiner Delay, damit Liris seine Components rendern kann
  setTimeout(() => {
    lirisWindow?.webContents.executeJavaScript(script).catch(err =>
      console.warn('[Liris] executeJavaScript Fehler:', err?.message ?? err)
    )
  }, 600)
}

ipcMain.handle('open-liris', async (_event, pid) => {
  try {
    openOrFocusLirisWindow(pid)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// IPC (synchron): App-Version aus dem Main-Process. Robuster als
// require('../package.json') im preload — Electron's app.getVersion() liest
// die Version direkt aus dem Package, das beim Build mitgegeben wurde.
ipcMain.on('app-version-sync', (event) => {
  event.returnValue = app.getVersion()
})

// IPC: write .ics to temp folder and open with default calendar app (Outlook)
ipcMain.handle('open-ics', async (_event, content, filename) => {
  try {
    const tmpPath = path.join(os.tmpdir(), filename)
    fs.writeFileSync(tmpPath, content, 'utf-8')
    await shell.openPath(tmpPath)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// Brief-HTML zu PDF rendern und in Downloads ablegen. Anschliessend wird
// die Datei im Explorer markiert (showItemInFolder), sodass der User sie
// per Drag&Drop direkt in den Liris-Webview ziehen kann.
// PDF aus Brief-HTML rendern und in tmp ablegen (Postausgang-Workflow).
// Gibt den Pfad zurueck — die Datei wird spaeter via startPdfDrag oder
// openMailWithAttachments referenziert und am Schluss via deletePdfTmp
// wieder geloescht.
ipcMain.handle('write-pdf-tmp', async (_event, arrayBuffer, suggestedFilename) => {
  try {
    const safe = (suggestedFilename || 'Brief.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_')
    const name = safe.endsWith('.pdf') ? safe : safe + '.pdf'
    const dir  = path.join(os.tmpdir(), 'azs-postausgang')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, Date.now() + '-' + name)
    fs.writeFileSync(target, Buffer.from(arrayBuffer))
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('delete-pdf-tmp', async (_event, filePath) => {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); return { ok: true } }
  catch (err) { return { ok: false, error: String(err) } }
})

// Startet einen Drag-Vorgang im sendenden Fenster mit der PDF als Datei.
// Muss im 'dragstart'-Lifecycle aufgerufen werden, sonst wirkt es nicht.
// 16x16 transparentes PNG (Base64) als Default-Drag-Icon. Electron's
// startDrag verlangt ein nicht-leeres NativeImage — createEmpty() schlaegt
// auf manchen Versionen still fehl und der Drag-Vorgang startet erst gar nicht.
const DRAG_ICON_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVR4nGNgGAWjYBSMglEwCgAABZgAAU01H1cAAAAASUVORK5CYII='

ipcMain.on('start-pdf-drag', (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      console.warn('[start-pdf-drag] Datei nicht gefunden:', filePath)
      return
    }
    let icon = nativeImage.createFromBuffer(Buffer.from(DRAG_ICON_PNG_B64, 'base64'))
    if (icon.isEmpty()) {
      // Fallback: App-Icon aus den Build-Assets
      try {
        const iconPath = path.join(__dirname, 'assets', 'icon.ico')
        if (fs.existsSync(iconPath)) icon = nativeImage.createFromPath(iconPath)
      } catch { /* ignore */ }
    }
    console.log('[start-pdf-drag] starting drag for', filePath)
    event.sender.startDrag({ file: filePath, icon })
  } catch (err) {
    console.warn('[start-pdf-drag] failed:', err)
  }
})

// PDF direkt ins Liris-Webview hochladen via Chrome DevTools Protocol.
// Vorbedingung: der Liris-Upload-Dialog ist offen (nach 'Dokument
// importieren' -> Arzt -> Mail gesendet), sodass ein <input type=file>
// im DOM existiert. Normales JS darf file-inputs nicht befuellen — das
// CDP-Kommando DOM.setFileInputFiles schon.
ipcMain.handle('upload-pdf-to-liris', async (_event, webContentsId, filePath) => {
  const { webContents } = require('electron')
  let wc = null
  let attached = false
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'Datei nicht gefunden' }
    wc = webContents.fromId(webContentsId)
    if (!wc) return { ok: false, error: 'Liris-Webview nicht gefunden' }

    try { wc.debugger.attach('1.3') ; attached = true }
    catch (e) {
      // evtl. schon attached (z.B. DevTools offen)
      return { ok: false, error: 'Debugger-Attach fehlgeschlagen — sind die DevTools im Liris offen? (' + String(e) + ')' }
    }

    const { root } = await wc.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true })

    // file-input suchen — auch in Frames (pierce:true liefert Shadow/Frame-Knoten).
    // Wir nutzen DOM.querySelectorAll auf dem Root.
    const { nodeIds } = await wc.debugger.sendCommand('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]',
    })

    if (!nodeIds || nodeIds.length === 0) {
      return { ok: false, error: 'Kein Upload-Feld in Liris gefunden. Bitte zuerst "Dokument importieren" oeffnen.' }
    }

    // Letztes file-input nehmen (der zuletzt geoeffnete Upload-Dialog).
    const targetNodeId = nodeIds[nodeIds.length - 1]
    await wc.debugger.sendCommand('DOM.setFileInputFiles', {
      nodeId: targetNodeId,
      files: [filePath],
    })

    return { ok: true }
  } catch (err) {
    console.error('[upload-pdf-to-liris] failed', err)
    return { ok: false, error: String(err && err.message || err) }
  } finally {
    if (wc && attached) { try { wc.debugger.detach() } catch { /* no-op */ } }
  }
})

// Outlook (oder Default-Mailclient) mit Attachments oeffnen.
// Strategie: HTML-Email-Datei mit mailto-Trick funktioniert nicht
// universell mit Attachments. Wir oeffnen den Default-Client mit
// 'attachment=' Parameter, was nur Outlook unterstuetzt. Fallback:
// Wir markieren die Dateien im Explorer, User zieht selbst ins Mail.
ipcMain.handle('open-mail-with-attachments', async (_event, filePaths, subject) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return { ok: false, error: 'keine Dateien' }
    if (process.platform === 'win32') {
      // Outlook via /a-Switch
      const { spawn } = require('child_process')
      const outlookPaths = [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE',
        'C:\\Program Files\\Microsoft Office\\Office16\\OUTLOOK.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\Office16\\OUTLOOK.EXE',
      ]
      const outlookExe = outlookPaths.find(p => fs.existsSync(p))
      if (outlookExe) {
        // /a kann nur eine Datei zugleich -> wir hangen alle als zusaetzliche
        // /a-Argumente an; Outlook akzeptiert das.
        const args = []
        for (const f of filePaths) { args.push('/a', f) }
        spawn(outlookExe, args, { detached: true, stdio: 'ignore' }).unref()
        return { ok: true }
      }
    }
    // Fallback: Ordner mit den Dateien oeffnen + leere mailto
    try { shell.showItemInFolder(filePaths[0]) } catch { /* no-op */ }
    shell.openExternal('mailto:?subject=' + encodeURIComponent(subject || 'Briefe'))
    return { ok: true, fallback: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

// PDF aus Brief-HTML rendern und Buffer zurueckliefern (kein Schreiben).
// Wird vom Postausgang-Workflow genutzt — Renderer erstellt einen Blob,
// gibt ihn an PostausgangContext weiter, der via write-pdf-tmp eine
// temporaere Datei fuer Drag&Drop / Mail-Attach anlegt.
ipcMain.handle('render-brief-pdf', async (_event, html) => {
  let win = null
  try {
    win = new BrowserWindow({
      show: false, width: 794, height: 1123,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
    const tmpHtml = path.join(os.tmpdir(), 'az-brief-' + Date.now() + '.html')
    fs.writeFileSync(tmpHtml, html, 'utf-8')
    try {
      await win.loadFile(tmpHtml)
      await new Promise(r => setTimeout(r, 250))
      const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4', printBackground: true, margins: { marginType: 'none' },
      })
      // Buffer in ArrayBuffer konvertieren damit der IPC-Channel ihn sauber transportiert
      const ab = pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength)
      return { ok: true, buffer: ab }
    } finally {
      try { fs.unlinkSync(tmpHtml) } catch { /* no-op */ }
    }
  } catch (err) {
    console.error('[render-brief-pdf] failed', err)
    return { ok: false, error: String(err && err.stack || err) }
  } finally {
    if (win) win.destroy()
  }
})

ipcMain.handle('save-brief-pdf', async (_event, html, suggestedFilename) => {
  let win = null
  try {
    console.log('[save-brief-pdf] starting, html.length=', html?.length, 'filename=', suggestedFilename)
    win = new BrowserWindow({
      show: false,
      width: 794,   // A4 @96dpi
      height: 1123,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: false }
    })
    // dataUrl-Approach scheitert bei langem HTML (>2MB Limit). Stattdessen
    // HTML in temp-Datei schreiben und via file:// laden.
    const tmpHtml = path.join(os.tmpdir(), 'az-brief-' + Date.now() + '.html')
    fs.writeFileSync(tmpHtml, html, 'utf-8')
    try {
      await win.loadFile(tmpHtml)
      // Kurz warten damit CSS-Rendering komplett ist
      await new Promise(r => setTimeout(r, 250))
      const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { marginType: 'none' },
      })
      console.log('[save-brief-pdf] PDF rendered, bytes=', pdfBuffer.length)
      const downloads = app.getPath('downloads')
      const safe = (suggestedFilename || 'Brief.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_')
      const target = path.join(downloads, safe.endsWith('.pdf') ? safe : safe + '.pdf')
      fs.writeFileSync(target, pdfBuffer)
      console.log('[save-brief-pdf] saved to', target)
      try { shell.showItemInFolder(target) } catch (e) { console.warn('[save-brief-pdf] showItemInFolder failed', e) }
      return { ok: true, path: target }
    } finally {
      try { fs.unlinkSync(tmpHtml) } catch { /* no-op */ }
    }
  } catch (err) {
    console.error('[save-brief-pdf] failed', err)
    return { ok: false, error: String(err && err.stack || err) }
  } finally {
    if (win) win.destroy()
  }
})

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Auto-Updater — prueft beim Start auf neue Releases.
 *
 * Provider: GitHub Releases (gleiches Repo wie der Code). Sobald der CI-
 * Workflow .github/workflows/release.yml einen neuen Tag baut und das .exe
 * hochlaedt, ziehen alle Praxis-PCs es beim naechsten Start automatisch
 * im Hintergrund. Beim Beenden der App wird das Update installiert.
 *
 * Funktioniert NUR in der gepackten App (isDev=false). Im Dev-Modus
 * absichtlich skipped, sonst meckert electron-updater jedes Mal.
 */
function setupAutoUpdater() {
  if (isDev) return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload         = true
    autoUpdater.autoInstallOnAppQuit = true
    // Hilfsfunktion: Status an alle offenen Fenster broadcasten — die Renderer-
    // Seite (HelpPage) hoert via electronApp.onUpdateProgress und zeigt einen
    // sichtbaren Fortschrittsbalken.
    function broadcast(channel, payload) {
      for (const w of BrowserWindow.getAllWindows()) {
        try { w.webContents.send(channel, payload) } catch { /* ignore */ }
      }
    }
    autoUpdater.on('error', err => {
      console.warn('[Updater] Fehler:', err?.message ?? err)
      broadcast('updater-status', { state: 'error', message: String(err?.message ?? err) })
    })
    autoUpdater.on('checking-for-update',  ()   => broadcast('updater-status', { state: 'checking' }))
    autoUpdater.on('update-available',     info => { console.log('[Updater] verfuegbar:', info?.version); broadcast('updater-status', { state: 'available', version: info?.version }) })
    autoUpdater.on('update-not-available', ()   => { console.log('[Updater] keine neue Version'); broadcast('updater-status', { state: 'not-available' }) })
    autoUpdater.on('download-progress', p => {
      // p.percent = 0..100, p.bytesPerSecond, p.transferred, p.total
      broadcast('updater-status', {
        state: 'downloading',
        percent: Math.round(p.percent || 0),
        transferred: p.transferred,
        total: p.total,
      })
    })
    autoUpdater.on('update-downloaded', info => {
      console.log('[Updater] Geladen, installiert beim Beenden:', info?.version)
      broadcast('updater-status', { state: 'downloaded', version: info?.version })
      dialog.showMessageBox({
        type:    'info',
        buttons: ['Spaeter', 'Jetzt neustarten'],
        defaultId: 1,
        title:   'Update bereit',
        message: `Augenzentrum Suhr ${info?.version} wurde heruntergeladen.`,
        detail:  'Beim Neustart der App wird das Update installiert. Soll jetzt neugestartet werden?',
      }).then(({ response }) => {
        if (response === 1) autoUpdater.quitAndInstall()
      })
    })
    autoUpdater.checkForUpdatesAndNotify().catch(err =>
      console.warn('[Updater] checkForUpdatesAndNotify Fehler:', err?.message ?? err)
    )
  } catch (err) {
    // Modul nicht installiert oder feed nicht konfiguriert — kein Showstopper
    console.warn('[Updater] Setup uebersprungen:', err?.message ?? err)
  }
}
