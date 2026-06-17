const { app, BrowserWindow, shell, ipcMain, dialog, nativeImage, Menu } = require('electron')
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

// Voll-Automatik: Brief ins Liris importieren.
// Vorbedingung: User hat in Liris "Dokument importieren" geoeffnet, sodass
// die Arzt-Auswahl sichtbar ist. Sequenz:
//   1. Arzt-Link klicken (eindeutiger Match auf doctorLastName, sonst Abbruch)
//   2. Dokumenttyp 'Mail gesendet'-Link klicken
//   3. file-input via DOM.setFileInputFiles befuellen
// Bricht bei Mehrdeutigkeit/fehlendem Element kontrolliert ab (Akten-Sicherheit).
ipcMain.handle('auto-import-to-liris', async (_event, webContentsId, filePath, doctorLastName) => {
  const { webContents } = require('electron')
  let wc = null, attached = false
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  const log = []
  const step = (msg) => { log.push(msg); console.log('[auto-import] ' + msg) }
  const fail = (error) => ({ ok: false, error, log })
  try {
    step('Start. doctor="' + (doctorLastName || '') + '" file=' + filePath)
    if (!filePath || !fs.existsSync(filePath)) return fail('Datei nicht gefunden: ' + filePath)
    wc = webContents.fromId(webContentsId)
    if (!wc) return fail('Liris-Webview nicht gefunden (id=' + webContentsId + ')')
    try { wc.debugger.attach('1.3'); attached = true; step('Debugger attached') }
    catch (e) { return fail('Debugger-Attach fehlgeschlagen — sind die DevTools im Liris offen? (' + String(e) + ')') }

    const evalJs = async (expr) => {
      const r = await wc.debugger.sendCommand('Runtime.evaluate', { expression: expr, returnByValue: true })
      if (r.exceptionDetails) throw new Error('JS-Fehler in Liris: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails))
      return r.result.value
    }
    // Pruefen ob die Arzt-Auswahl (Import-Dialog) bereits sichtbar ist.
    const arztAuswahlDa = () => evalJs(`(function(){
      var as=[].slice.call(document.querySelectorAll('a'));
      for(var k=0;k<as.length;k++){
        var t=(as[k].innerText||'').trim().toLowerCase();
        if(t==='gleich wie verantwortlicher arzt') return true;
      }
      return /einen (ausf(?:ü|ue)hrenden|verantwortlichen) arzt/i.test(document.body?document.body.innerText:'');
    })()`)

    // ── Schritt 0: 'Dokument importieren' oeffnen (falls noch nicht offen) ───
    const alreadyOpen = await arztAuswahlDa()
    step('Schritt 0: Arzt-Auswahl bereits offen? ' + alreadyOpen)
    if (!alreadyOpen) {
      const opened = await evalJs(`(function(){
        var cands=[].slice.call(document.querySelectorAll('[data-tooltip],a,button'));
        for(var k=0;k<cands.length;k++){
          var el=cands[k];
          var tip=(el.getAttribute&&el.getAttribute('data-tooltip')||'').toLowerCase();
          var txt=(el.innerText||'').trim().toLowerCase();
          if(tip.indexOf('dokument importieren')>=0 || txt==='dokument importieren'){
            var clickTarget = el.closest ? (el.closest('a,button')||el) : el;
            clickTarget.click();
            try{ el.click(); }catch(e){}
            return tip||txt||'gefunden';
          }
        }
        return false;
      })()`)
      step('Schritt 0: "Dokument importieren" geklickt? ' + opened)
      if (!opened) return fail('"Dokument importieren" nicht gefunden. Ist der Patient in Liris geoeffnet?')
      let appeared = false
      for (let i = 0; i < 12 && !appeared; i++) { await sleep(350); appeared = await arztAuswahlDa() }
      step('Schritt 0: Arzt-Auswahl erschienen? ' + appeared)
      if (!appeared) return fail('Import-Dialog (Arzt-Auswahl) erschien nicht nach Klick auf "Dokument importieren".')
    }
    // Settle-Pause: die Links existieren oft schon im DOM bevor Liris die
    // Klick-Handler gebunden hat — zu fruehe Klicks verpuffen wirkungslos.
    await sleep(1000)

    // ── Schritt 1: Arzt waehlen ─────────────────────────────────────────────
    const ln = (doctorLastName || '').trim()
    const isOffen = !ln || ln.toLowerCase() === 'offen' || ln.toLowerCase() === 'keinem arzt zugewiesen'
    step('Schritt 1: Arzt waehlen (isOffen=' + isOffen + ')')
    if (isOffen) {
      let okShortcut = false
      for (let i = 0; i < 8 && !okShortcut; i++) {
        okShortcut = await evalJs(`(function(){
          var as=[].slice.call(document.querySelectorAll('a'));
          for(var k=0;k<as.length;k++){ if((as[k].innerText||'').trim().toLowerCase()==='gleich wie verantwortlicher arzt'){ as[k].click(); return true; } }
          return false;
        })()`)
        if (!okShortcut) await sleep(300)
      }
      step('Schritt 1: Shortcut "Gleich wie verantwortlicher Arzt" geklickt? ' + okShortcut)
      if (!okShortcut) return fail('Arzt-Shortcut nicht gefunden.')
    } else {
      const lnEsc = ln.replace(/[.*+?^${}()|[\]\\]/g, '')
      let res = null
      for (let i = 0; i < 8 && res !== 'ok'; i++) {
        res = await evalJs(`(function(){
          var ln=${JSON.stringify(lnEsc.toLowerCase())};
          var re=new RegExp('\\\\b'+ln+'\\\\b');
          var as=[].slice.call(document.querySelectorAll('a'));
          var hits=[];
          for(var k=0;k<as.length;k++){
            var t=(as[k].innerText||'').trim(); if(!t)continue;
            var low=t.toLowerCase();
            if(/(^|\\s)(dr|prof|med|medic)\\b|\\bdr\\.?\\s|prof\\.?\\s/.test(low) && re.test(low)) hits.push(as[k]);
          }
          if(hits.length===1){ hits[0].click(); return 'ok'; }
          if(hits.length===0) return 'none';
          return 'multiple';
        })()`)
        if (res !== 'ok' && res !== 'multiple') await sleep(300)
        if (res === 'multiple') break
      }
      step('Schritt 1: Arzt-Match-Ergebnis = ' + res)
      if (res === 'multiple') return fail('Mehrere Aerzte passen zu "' + ln + '". Bitte manuell waehlen.')
      if (res !== 'ok') return fail('Arzt "' + ln + '" nicht in Liris-Auswahl gefunden. Bitte manuell waehlen.')
    }
    await sleep(1200)

    // ── Schritt 2: Dokumenttyp 'Mail gesendet' ──────────────────────────────
    // Erst warten bis der Link EXISTIERT (ohne Klick), dann Settle-Pause,
    // dann klicken — sonst trifft der Klick einen noch nicht gebundenen Link.
    step('Schritt 2: "Mail gesendet" suchen…')
    const mailLinkDa = () => evalJs(`(function(){
      var as=[].slice.call(document.querySelectorAll('a'));
      for(var k=0;k<as.length;k++){ if((as[k].innerText||'').trim().toLowerCase()==='mail gesendet') return true; }
      return false;
    })()`)
    let mailVisible = false
    for (let i = 0; i < 10 && !mailVisible; i++) { mailVisible = await mailLinkDa(); if (!mailVisible) await sleep(400) }
    step('Schritt 2: "Mail gesendet"-Link sichtbar? ' + mailVisible)
    if (!mailVisible) return fail('"Mail gesendet" nicht gefunden. Wurde ein Arzt gewaehlt?')
    await sleep(800)
    const mailOk = await evalJs(`(function(){
      var as=[].slice.call(document.querySelectorAll('a'));
      for(var k=0;k<as.length;k++){ if((as[k].innerText||'').trim().toLowerCase()==='mail gesendet'){ as[k].click(); return true; } }
      return false;
    })()`)
    step('Schritt 2: "Mail gesendet" geklickt? ' + mailOk)
    if (!mailOk) return fail('"Mail gesendet"-Klick fehlgeschlagen.')
    await sleep(1200)

    // ── Schritt 3: Datei ins file-input ─────────────────────────────────────
    step('Schritt 3: file-input suchen…')
    let fileSet = false, foundCount = 0
    for (let i = 0; i < 8 && !fileSet; i++) {
      const { root } = await wc.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
      const { nodeIds } = await wc.debugger.sendCommand('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type="file"]' })
      foundCount = (nodeIds || []).length
      if (nodeIds && nodeIds.length) {
        await wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files: [filePath] })
        fileSet = true
      } else { await sleep(400) }
    }
    step('Schritt 3: file-inputs gefunden=' + foundCount + ', gesetzt=' + fileSet)
    if (!fileSet) return fail('Upload-Feld nicht gefunden.')
    // Manche Frameworks hoeren nur auf input/change — sicherheitshalber
    // beide Events auf dem letzten file-input nachfeuern.
    await sleep(300)
    const evFired = await evalJs(`(function(){
      var ins=document.querySelectorAll('input[type="file"]');
      if(!ins.length) return false;
      var el=ins[ins.length-1];
      try{ el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return el.files?el.files.length:0; }
      catch(e){ return 'ev-error:'+e; }
    })()`)
    step('Schritt 3: change-Events gefeuert, files.length=' + evFired)

    step('Fertig — Upload gesetzt.')
    return { ok: true, log }
  } catch (err) {
    console.error('[auto-import-to-liris] failed', err)
    return fail(String(err && err.message || err))
  } finally {
    if (wc && attached) { try { wc.debugger.detach() } catch { /* no-op */ } }
  }
})

// Outlook (oder Default-Mailclient) mit Attachments oeffnen.
// Strategie: HTML-Email-Datei mit mailto-Trick funktioniert nicht
// universell mit Attachments. Wir oeffnen den Default-Client mit
// 'attachment=' Parameter, was nur Outlook unterstuetzt. Fallback:
// Wir markieren die Dateien im Explorer, User zieht selbst ins Mail.
ipcMain.handle('open-mail-with-attachments', async (_event, filePaths, subject, recipient, bodyText) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return { ok: false, error: 'keine Dateien' }
    // Mit Empfaenger ODER mehreren Anhaengen: .eml-Entwurf bauen (Outlook
    // oeffnet ihn dank X-Unsent:1 als bearbeitbaren, sendebereiten Entwurf
    // mit ALLEN Attachments + Empfaenger). Outlook /a kann das nicht
    // zuverlaessig kombinieren.
    const boundary = 'azs_' + Date.now()
    const CRLF = '\r\n'
    let eml = ''
    if (recipient) eml += 'To: ' + recipient + CRLF
    eml += 'Subject: ' + (subject || 'Briefe Augenzentrum Suhr') + CRLF
    eml += 'X-Unsent: 1' + CRLF
    eml += 'MIME-Version: 1.0' + CRLF
    eml += 'Content-Type: multipart/mixed; boundary="' + boundary + '"' + CRLF + CRLF
    eml += '--' + boundary + CRLF
    eml += 'Content-Type: text/plain; charset=utf-8' + CRLF + CRLF
    eml += (bodyText || 'Briefe im Anhang zum Drucken / Versenden.') + CRLF + CRLF
    for (const f of filePaths) {
      if (!fs.existsSync(f)) continue
      const b64 = fs.readFileSync(f).toString('base64')
      const name = path.basename(f)
      eml += '--' + boundary + CRLF
      eml += 'Content-Type: application/pdf; name="' + name + '"' + CRLF
      eml += 'Content-Transfer-Encoding: base64' + CRLF
      eml += 'Content-Disposition: attachment; filename="' + name + '"' + CRLF + CRLF
      eml += b64.replace(/(.{76})/g, '$1' + CRLF) + CRLF
    }
    eml += '--' + boundary + '--' + CRLF
    const emlPath = path.join(os.tmpdir(), 'azs-mail-' + Date.now() + '.eml')
    fs.writeFileSync(emlPath, eml)
    await shell.openPath(emlPath)
    return { ok: true }
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

ipcMain.handle('print-html', async (_event, html, opts) => {
  let win = null
  try {
    const pw = opts?.pageWidth || 794
    const ph = opts?.pageHeight || 1123
    win = new BrowserWindow({
      show: false,
      width: pw,
      height: ph,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
    const tmpHtml = path.join(os.tmpdir(), 'az-print-' + Date.now() + '.html')
    fs.writeFileSync(tmpHtml, html, 'utf-8')
    try {
      await win.loadFile(tmpHtml)
      await new Promise(r => setTimeout(r, 300))
      await new Promise((resolve, reject) => {
        win.webContents.print({
          silent: false,
          printBackground: true,
          margins: { marginType: 'none' },
        }, (success, reason) => {
          if (success) resolve()
          else reject(new Error(reason || 'Print cancelled'))
        })
      })
      return { ok: true }
    } finally {
      try { fs.unlinkSync(tmpHtml) } catch { /* no-op */ }
    }
  } catch (err) {
    console.error('[print-html] failed', err)
    return { ok: false, error: String(err && err.stack || err) }
  } finally {
    if (win) win.destroy()
  }
})

ipcMain.handle('open-print-html', async (_event, html) => {
  try {
    const tmpFile = path.join(os.tmpdir(), 'az-overlay-' + Date.now() + '.html')
    fs.writeFileSync(tmpFile, html, 'utf-8')
    await shell.openExternal('file://' + tmpFile.replace(/\\/g, '/'))
    return { ok: true, path: tmpFile }
  } catch (err) {
    console.error('[open-print-html] failed', err)
    return { ok: false, error: String(err && err.stack || err) }
  }
})

app.whenReady().then(() => {
  const version = app.getVersion()
  const template = [
    {
      label: 'Datei',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'forceReload', label: 'Neu laden (Cache leeren)' },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederherstellen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'zoomIn', label: 'Vergrössern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { role: 'resetZoom', label: 'Standardgrösse' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: `Version ${version}`,
          enabled: false,
        },
        {
          label: '© Saran Pasquale',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Entwicklertools',
          accelerator: 'F12',
          click: () => {
            const w = BrowserWindow.getFocusedWindow()
            if (w) w.webContents.toggleDevTools()
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

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
