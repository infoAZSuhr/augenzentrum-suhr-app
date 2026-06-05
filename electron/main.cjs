const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron')
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
    autoUpdater.on('error', err => console.warn('[Updater] Fehler:', err?.message ?? err))
    autoUpdater.on('update-available',     info => console.log('[Updater] Update verfuegbar:', info?.version))
    autoUpdater.on('update-not-available', ()   => console.log('[Updater] Keine neue Version'))
    autoUpdater.on('update-downloaded', info => {
      console.log('[Updater] Geladen, installiert beim Beenden:', info?.version)
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
