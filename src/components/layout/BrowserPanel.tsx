import { useRef, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, X, GripVertical, FileEdit } from 'lucide-react'
import { useBrowser } from '../../contexts/BrowserContext'
import { useAuth } from '../../lib/AuthContext'
import { useToast } from '../../lib/ToastContext'

/** Extrahiert Geburtsdatum + Autor aus der aktuell in Liris geoeffneten
 *  Patient-Untersuchung. Heuristisch — versucht mehrere DOM-Patterns weil
 *  wir die genaue Liris-HTML-Struktur nicht kennen. Gibt null zurueck wenn
 *  nichts gefunden.
 *
 *  Wird nach PID-Inject + ~1.5s Render-Delay ausgefuehrt. */
async function extractLirisInfo(wv: any, pid: string): Promise<{ pid: string; pidMatchesLiris: boolean; vorname: string | null; nachname: string | null; gebDatum: string | null; autor: string | null; letzteKons: string | null; intervalWeeks: number | null; notFound: boolean; verstorben: boolean; anrede: string | null; postAdresse: string | null; email: string | null; emailVerdaechtig: string | null; bpKeywords: string[]; naechsterTerminDatum: string | null; naechsterTerminZeit: string | null; naechsterTerminRaw: string | null; bpText: string | null; zusKontaktName: string | null; zusKontaktAdresse: string | null; zusKontaktTyp: 'vertreter' | 'kontaktperson' | null } | null> {
  if (!wv?.executeJavaScript) return null
  // PID ohne # — Liris zeigt evtl. mit oder ohne Padding (0042 vs 42).
  const expectedPidDigits = (pid || '').replace(/\D/g, '').replace(/^0+/, '')
  const script = `
    (function() {
      var expectedPid = ${JSON.stringify(expectedPidDigits)};
      var result = { pidMatchesLiris: false, vorname: null, nachname: null, gebDatum: null, autor: null, letzteKons: null, intervalWeeks: null, notFound: false, verstorben: false, anrede: null, postAdresse: null, email: null, emailVerdaechtig: null, bpKeywords: [], naechsterTerminDatum: null, naechsterTerminZeit: null, naechsterTerminRaw: null, bpText: null, zusKontaktName: null, zusKontaktAdresse: null, zusKontaktTyp: null, _debug: { textLen: 0 } };
      function collectText(doc) {
        var t = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
        var frames = doc.querySelectorAll ? doc.querySelectorAll('iframe') : [];
        for (var i = 0; i < frames.length; i++) {
          try {
            var inner = frames[i].contentDocument;
            if (inner) t += '\\n' + collectText(inner);
          } catch (e) { /* cross-origin iframe — skip */ }
        }
        return t;
      }
      var allText = collectText(document);
      result._debug.textLen = allText.length;

      // 0) PID-Verifikation: pruefe ob die ERWARTETE PID irgendwo im Text vorkommt.
      //    Liris padded gelegentlich Zeros ("#0042"), wir normalisieren auf reine
      //    Ziffern ohne Leading-Zeros. Match-Pattern: #?0*<pid>(?!\\d) — verhindert
      //    dass "#42" auch in "#420" matched.
      if (expectedPid) {
        var pidRe = new RegExp('#?0*' + expectedPid + '(?!\\\\d)');
        result.pidMatchesLiris = pidRe.test(allText);
      }

      // Not-Found-Erkennung
      if (/Kein\\s+Patient/i.test(allText) ||
          /keine\\s+Treffer/i.test(allText) ||
          /nicht\\s+gefunden/i.test(allText) ||
          /nicht\\s+vorhanden/i.test(allText)) {
        result.notFound = true;
      }

      // 1) Geburtsdatum: nur DD.MM.YYYY MIT "(NN Jahre)"-Suffix akzeptieren.
      //    Verhindert dass "Untersuchung vom 14.01.2026" als gebDatum gelesen wird.
      var birthRe = /(\\d{2})\\.(\\d{2})\\.(19\\d{2}|20[0-2]\\d)\\s*\\(\\s*\\d+\\s*Jahre?\\s*\\)/;
      var bm = allText.match(birthRe);
      if (bm) result.gebDatum = bm[3] + '-' + bm[2] + '-' + bm[1];

      // 2) Name: Liris zeigt "Anrede Nachname Vorname(n), DD.MM.YYYY (NN Jahre)"
      // Anrede kann auch "Kind(F)" oder "Kind(M)" sein
      var nameRe = /(?:Frau|Herr|Fr\\.|Hr\\.|Kind\\([FM]\\))\\s+([A-ZÄÖÜ][\\wäöüÄÖÜß-]+(?:\\s+[A-ZÄÖÜ][\\wäöüÄÖÜß-]+)*?)\\s*,?\\s*\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\(/;
      var nm = allText.match(nameRe);
      if (nm) {
        var parts = nm[1].trim().split(/\\s+/);
        result.nachname = parts[0];
        result.vorname = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
      }

      // 2b) Verstorben: Kreuz vor dem Anrede-Block.
      var dagger = String.fromCharCode(0x2020);
      var cross  = String.fromCharCode(0x271D);
      var kreuzRe = new RegExp('[' + dagger + cross + ']\\\\s*(?:Herr|Frau|Fr\\\\.|Hr\\\\.)', 'i');
      if (kreuzRe.test(allText)) {
        result.verstorben = true;
      }

      // 3) Untersuchungs-Datum: "Untersuchung vom DD.MM.YYYY" → letzteKons
      var untersMatch = allText.match(/Untersuchung\\s+vom\\s+(\\d{2})\\.(\\d{2})\\.(19\\d{2}|20[0-2]\\d)/i);
      if (untersMatch) result.letzteKons = untersMatch[3] + '-' + untersMatch[2] + '-' + untersMatch[1];

      // 4) Naechster Termin in N Wochen — z.B. "Naechster Termin in 4 Wochen"
      //    oder isoliert "4 Wochen" direkt unter "Naechster Termin".
      //    Akzeptiert auch Monate ("in 3 Monaten") und konvertiert zu Wochen
      //    (1 Monat ~ 4 Wochen, grob, das exakte Intervall ist eh nur Hinweis).
      //    Toleranter: erlaubt Zwischenwoerter wie "Kontrolle in" zwischen
      //    "Naechster Termin" und der Zahl (z.B. "Naechster Termin: Kontrolle
      //    in 12 Monaten" oder "Naechster Termin\\n12 Monate, Myd und OCT").
      // 4a) Rohtext "Nächster Termin" extrahieren (für User-Anzeige)
      //     Erfasst Text auf gleicher Zeile UND nächste Zeile (da Liris
      //     Header und Wert oft auf getrennten Zeilen zeigt).
      var ntRawRe = /N(?:ä|ae)chster\\s+Termin\\s*:?\\s*([^\\n]{0,120}(?:\\n[^\\n]{1,120})?)/i;
      var ntRaw = allText.match(ntRawRe);
      var ntSection = '';
      if (ntRaw) {
        var ntVal = ntRaw[1].replace(/^\\s*\\n\\s*/, '').trim();
        if (ntVal) { result.naechsterTerminRaw = ntVal; ntSection = ntVal; }
      }

      // Intervall nur aus "Nächster Termin"-Abschnitt suchen
      if (ntSection) {
        var intervalRe = /(?:in\\s+)?(\\d+)\\s*(Wochen?|Monate?n?|Jahre?n?)/i;
        var iv = ntSection.match(intervalRe);
        if (iv) {
          var n = parseInt(iv[1], 10);
          if (/Monat/i.test(iv[2])) n = n * 4;
          else if (/Jahr/i.test(iv[2])) n = n * 52;
          if (n > 0 && n <= 260) result.intervalWeeks = n;
        }
      }

      // 4b) Fallback: "Beurteilung und Prozedere"-Abschnitt scannen
      {
        var bpStart = allText.search(/Beurteilung\\s+und\\s+Prozedere/i);
        if (bpStart >= 0) {
          var bpText = allText.slice(bpStart, bpStart + 800);
          var bpEnd = bpText.search(/\\n\\s*(?:Anamnese|Befund|Untersuchung\\s+vom|Autor)\\b/i);
          if (bpEnd > 0) bpText = bpText.slice(0, bpEnd);
          // Rohtext speichern (Header entfernen)
          var bpBody = bpText.replace(/^Beurteilung\\s+und\\s+Prozedere\\s*/i, '').trim();
          if (bpBody) result.bpText = bpBody;
          // 4b-i) numerische Phrase — nur wenn NT kein Intervall geliefert hat
          if (!result.intervalWeeks) {
          var fallbackRe = /(?:Kontrolle|Wiedervorstellung|Nachkontrolle|VK|Verlaufskontrolle|wieder|N(?:ä|ae)chster\\s+Termin)\\D{0,40}?(?:in\\s+)?(\\d+)\\s+(Wochen?|Monate?n?|Jahre?n?)|in\\s+(\\d+)\\s+(Wochen?|Monate?n?|Jahre?n?)\\D{0,15}?wieder/i;
          var fm = bpText.match(fallbackRe);
          if (!fm) fm = bpText.match(/(?:in\\s+)?(\\d+)\\s+(Wochen?|Monate?n?|Jahre?n?)(?:\\s|,|\\.|$)/i);
          if (fm) {
            var num = parseInt(fm[1] || fm[3], 10);
            var unit = fm[2] || fm[4];
            if (/Monat/i.test(unit)) num = num * 4;
            else if (/Jahr/i.test(unit)) num = num * 52;
            if (num > 0 && num <= 260) result.intervalWeeks = num;
          }
          } // end if (!result.intervalWeeks) for numeric B+P
          // 4b-ii) Monatsname: "Kontrolle November", "VK im Mai 2027",
          //        "Wiedervorstellung Januar 2027". Distanz ab letzteKons
          //        (Fallback: heute) bis zum 15. des Zielmonats → Wochen.
          if (!result.intervalWeeks) {
            var monthMap = { januar:0, februar:1, märz:2, maerz:2, april:3, mai:4, juni:5,
                             juli:6, august:7, september:8, oktober:9, november:10, dezember:11 };
            var monthRe = /(?:Kontrolle|Wiedervorstellung|Nachkontrolle|VK|Verlaufskontrolle)\\D{0,30}?(?:im\\s+|am\\s+|ab\\s+)?(Januar|Februar|M(?:\\u00e4|ae)rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?:\\s+(\\d{4}))?/i;
            var mm = bpText.match(monthRe);
            if (mm) {
              var monKey = mm[1].toLowerCase().replace('ä','ae');
              var monIdx = monthMap[monKey];
              if (monIdx === undefined) monIdx = monthMap[mm[1].toLowerCase()];
              if (typeof monIdx === 'number') {
                // Referenzdatum: letzteKons falls extrahiert, sonst heute
                var refMs;
                if (result.letzteKons) {
                  var lk = result.letzteKons.split('-');
                  refMs = Date.UTC(parseInt(lk[0],10), parseInt(lk[1],10)-1, parseInt(lk[2],10));
                } else {
                  var now = new Date();
                  refMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
                }
                var refY = new Date(refMs).getUTCFullYear();
                var targetY = mm[2] ? parseInt(mm[2], 10) : refY;
                // Zieldatum = 15. des Monats. Ohne Jahresangabe wird das
                // Jahr des Referenzdatums verwendet (kein Roll-Over ins
                // naechste Jahr) — wenn der Monat dieses Jahres schon vorbei
                // ist, wird das Intervall einfach nicht gesetzt.
                var targetMs = Date.UTC(targetY, monIdx, 15);
                var diffWeeks = Math.round((targetMs - refMs) / (7 * 86400000));
                if (diffWeeks > 0 && diffWeeks <= 260) result.intervalWeeks = diffWeeks;
              }
            }
          }
        }
      }

      // 5) Autor: NUR aus dem "Untersuchung vom ..."-Block lesen — nicht
      //    irgendeinen "Autor:"-Treffer auf der Seite. Liris zeigt auch bei
      //    Notizen/Anmerkungen/Telefonaten einen "Autor:", ein blinder
      //    Seiten-weiter Match griff da faelschlich den Verfasser einer
      //    Notiz statt des Arztes der eigentlichen Untersuchung. Fix (Nutzer-
      //    wunsch): Autor nur erfassen, wenn er WIRKLICH im Untersuchungs-
      //    Block steht — Suchfenster ab "Untersuchung vom", begrenzt bis zum
      //    naechsten Eintrags-Header (Notiz/Anmerkung/Telefonat/naechste
      //    Untersuchung), damit kein fremder Eintrag hineinragt.
      if (untersMatch && untersMatch.index !== undefined) {
        var untersBlock = allText.slice(untersMatch.index, untersMatch.index + 2000);
        var blockEnd = untersBlock.slice(untersMatch[0].length).search(/\\n\\s*(?:Notiz|Anmerkung|Telefonat|Anruf|E-?Mail|Untersuchung\\s+vom)\\b/i);
        if (blockEnd > 0) untersBlock = untersBlock.slice(0, untersMatch[0].length + blockEnd);
        var autorMatch = untersBlock.match(/Autor:?\\s*([^\\n\\r]{1,80})/);
        if (autorMatch && autorMatch[1]) {
          result.autor = autorMatch[1].trim().replace(/\\s+/g, ' ').slice(0, 80);
          var stop = result.autor.search(/[,\\n\\r]|  /);
          if (stop > 0) result.autor = result.autor.slice(0, stop).trim();
        }
      }

      // 6) Anrede aus Patient-Header: "Herr ..." / "Frau ..." vor dem Namen.
      var anredeMatch = allText.match(/(Frau|Herr|Familie|Fr\\.|Hr\\.)\\s+[A-Z\\u00c4\\u00d6\\u00dc]/);
      if (anredeMatch) {
        var a = anredeMatch[1];
        if (a === 'Fr.') a = 'Frau';
        else if (a === 'Hr.') a = 'Herr';
        result.anrede = a;
      }

      // 7) Postadresse aus dem Kontaktangaben-Block. Liris-Format:
      //    "Kontaktangaben\\nStrasse Nr, PLZ Ort\\n+41XXXXX (natel)\\nmail@..."
      var kStart = allText.search(/Kontaktangaben/i);
      if (kStart >= 0) {
        var kBlock = allText.slice(kStart + 'Kontaktangaben'.length, kStart + 'Kontaktangaben'.length + 400);
        var kEnd = kBlock.search(/\\n\\s*(?:Verwaltungsbereich|@|\\+?\\d{2,4}\\s*[\\/\\s])/i);
        if (kEnd > 0) kBlock = kBlock.slice(0, kEnd);
        var addrLines = [];
        var rawLines = kBlock.split('\\n').map(function(l){return l.trim()}).filter(Boolean);
        for (var li = 0; li < rawLines.length; li++) {
          var l = rawLines[li];
          // Format A: "Strasse Nr, PLZ Ort" -> in 2 Zeilen aufsplitten. Hausnummer-
          // Zusatz (z.B. "15 b") kann MIT oder OHNE Leerzeichen vor dem Buchstaben
          // stehen — \\s? deckt beides ab.
          var combo = l.match(/^([A-Z\\u00c4\\u00d6\\u00dc][\\w\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc.\\s-]+\\s+\\d+\\s?[a-zA-Z]?)\\s*,\\s*(\\d{4,5}\\s+[A-Z\\u00c4\\u00d6\\u00dc][^\\d].*)$/);
          if (combo) { addrLines.push(combo[1].trim(), combo[2].trim()); continue; }
          // Format B: getrennte Zeilen
          if (/^[A-Z\\u00c4\\u00d6\\u00dc][\\w\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc.\\s-]+\\s+\\d+\\s?[a-zA-Z]?$/.test(l)) { addrLines.push(l); continue; }
          if (/^\\d{4,5}\\s+[A-Z\\u00c4\\u00d6\\u00dc]/.test(l)) { addrLines.push(l); continue; }
        }
        if (addrLines.length) result.postAdresse = addrLines.join('\\n');

        // Gesetzlicher Vertreter (Eltern bei Minderjährigen)
        // Suche das Label "Gesetzlicher Vertreter" direkt — danach folgt Name + Adresse
        var gvStart = allText.search(/Gesetzlicher\\s+Vertreter/i);
        if (gvStart >= 0) {
          var gvBlock = allText.slice(gvStart, gvStart + 500);
          var gvLines = gvBlock.split('\\n').map(function(l){return l.trim()}).filter(Boolean);
          // gvLines[0] = "Gesetzlicher Vertreter" oder "Gesetzlicher Vertreter & Rechnungskontakt :"
          // Erste Zeile nach dem Label, die kein weiteres Sub-Label ist = Name
          var gvNameIdx = -1;
          for (var gi = 1; gi < gvLines.length && gi < 6; gi++) {
            var gt = gvLines[gi];
            if (/^(Verwaltungsbereich|Andere Versicherungen|Kontaktangaben|Zus[aä]tzlicher|Rechnungsadresse)/i.test(gt)) break;
            if (/:\\s*$/.test(gt) || /Vertreter|Rechnungskontakt|gesetzlich/i.test(gt)) continue;
            gvNameIdx = gi; break;
          }
          if (gvNameIdx >= 0) {
            var gvRaw = gvLines[gvNameIdx];
            // Bereinigen: "(Vater)", "(Mutter)" und Telefonnummern entfernen
            var gvName = gvRaw.replace(/\\s*\\([^)]*\\)/g, '').replace(/,\\s*0\\d[\\d\\/\\s]+$/, '').trim();
            result.zusKontaktName = gvName;
            var gvAddr = [];
            for (var gj = gvNameIdx + 1; gj < gvLines.length && gj < gvNameIdx + 5; gj++) {
              var gl = gvLines[gj];
              if (/^(Verwaltungsbereich|Andere Versicherungen|Kontaktangaben|Zus|Rechnungsadresse)/i.test(gl)) break;
              if (/:\\s*$/.test(gl) || /Vertreter|Rechnungskontakt|gesetzlich/i.test(gl)) break;
              var gCombo = gl.match(/^([A-Z\\u00c4\\u00d6\\u00dc][\\w\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc.\\s-]+\\s+\\d+\\s?[a-zA-Z]?)\\s*,\\s*(\\d{4,5}\\s+[A-Z\\u00c4\\u00d6\\u00dc][^\\d].*)$/);
              if (gCombo) { gvAddr.push(gCombo[1].trim(), gCombo[2].trim()); break; }
              if (/^[A-Z\\u00c4\\u00d6\\u00dc][\\w\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc.\\s-]+\\s+\\d+\\s?[a-zA-Z]?$/.test(gl)) { gvAddr.push(gl); continue; }
              if (/^\\d{4,5}\\s+[A-Z\\u00c4\\u00d6\\u00dc]/.test(gl)) { gvAddr.push(gl); break; }
            }
            if (gvAddr.length) result.zusKontaktAdresse = gvAddr.join('\\n');
            result.zusKontaktTyp = 'vertreter';
          }
        }

        // "Zusätzlicher Kontakt" (z.B. "Waldvogel Daniela (Kontaktperson), 079/...")
        // — Typ aus der Klammer lesen: Kontaktperson vs. Vormund/Beistand/
        // Vertreter. Nur wenn nicht schon ein gesetzlicher Vertreter gefunden.
        if (!result.zusKontaktName) {
          var zkStart = allText.search(/Zus[a\\u00e4]tzlicher\\s+Kontakt/i);
          if (zkStart >= 0) {
            var zkBlock = allText.slice(zkStart, zkStart + 500);
            var zkLines = zkBlock.split('\\n').map(function(l){return l.trim()}).filter(Boolean);
            var zkNameIdx = -1;
            for (var zi = 1; zi < zkLines.length && zi < 6; zi++) {
              var zt = zkLines[zi];
              if (/^(Verwaltungsbereich|Andere Versicherungen|Kontaktangaben|Rechnungsadresse)/i.test(zt)) break;
              if (/:\\s*$/.test(zt)) continue;
              zkNameIdx = zi; break;
            }
            if (zkNameIdx >= 0) {
              var zkRaw = zkLines[zkNameIdx];
              var zkRole = (zkRaw.match(/\\(([^)]*)\\)/) || [])[1] || '';
              result.zusKontaktName = zkRaw.replace(/\\s*\\([^)]*\\)/g, '').replace(/,\\s*0\\d[\\d\\/\\s]+$/, '').trim();
              result.zusKontaktTyp = /vormund|beistand|vertreter|vater|mutter/i.test(zkRole) ? 'vertreter' : 'kontaktperson';
              var zkAddr = [];
              for (var zj = zkNameIdx + 1; zj < zkLines.length && zj < zkNameIdx + 5; zj++) {
                var zl = zkLines[zj];
                if (/^(Verwaltungsbereich|Andere Versicherungen|Kontaktangaben|Rechnungsadresse)/i.test(zl)) break;
                if (/:\\s*$/.test(zl)) break;
                var zCombo = zl.match(/^([A-Z\\u00c4\\u00d6\\u00dc][\\w\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc.\\s-]+\\s+\\d+\\s?[a-zA-Z]?)\\s*,\\s*(\\d{4,5}\\s+[A-Z\\u00c4\\u00d6\\u00dc][^\\d].*)$/);
                if (zCombo) { zkAddr.push(zCombo[1].trim(), zCombo[2].trim()); break; }
                if (/^[A-Z\\u00c4\\u00d6\\u00dc][\\w\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc.\\s-]+\\s+\\d+\\s?[a-zA-Z]?$/.test(zl)) { zkAddr.push(zl); continue; }
                if (/^\\d{4,5}\\s+[A-Z\\u00c4\\u00d6\\u00dc]/.test(zl)) { zkAddr.push(zl); break; }
              }
              if (zkAddr.length) result.zusKontaktAdresse = zkAddr.join('\\n');
            }
          }
        }

        // Email aus dem gesamten Kontaktangaben-Bereich (inkl. Telefonbereich
        // darunter) extrahieren. Wir greifen den 600-Zeichen-Block nach
        // 'Kontaktangaben' und nehmen das erste E-Mail-Muster.
        var emailBlock = allText.slice(kStart, kStart + 600);
        var emailMatch = emailBlock.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/);
        if (emailMatch) result.email = emailMatch[0];
        // Verdaechtige (fast-)E-Mail erkennen: enthaelt ein @, aber keine
        // gueltige Domain-Endung — typisch ein Tippfehler in Liris wie
        // "name@bluewin-ch" statt "name@bluewin.ch". Wird der MPA als
        // Hinweis angezeigt, damit der Eintrag in Liris korrigiert wird.
        if (!result.email) {
          var relaxed = emailBlock.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9._-]+/);
          if (relaxed) result.emailVerdaechtig = relaxed[0];
        }
      }

      // 8) Zukuenftiger Termin mit Datum + Uhrzeit. Heuristik:
      //    a) "Naechster Termin: DD.MM.YYYY HH:MM"  (Detailansicht)
      //    b) "DD.MM.YYYY HH:MM Konsultation/Untersuchung/..." (Listenansicht)
      //    c) "@HH:MM ... DD.MM.YYYY" naher Patient-Name (Tagesplan)
      //    Wir akzeptieren NUR ein Datum das in der Zukunft liegt.
      function isFuture(yyyy, mm, dd) {
        var today = new Date();
        today.setHours(0,0,0,0);
        var d = new Date(yyyy, mm-1, dd);
        return d.getTime() >= today.getTime();
      }
      // Pattern a: "Naechster Termin (von Dr. X): DD.MM.YYYY, HH:MM" —
      // Liris zeigt oft den Arzt in Klammern vor dem Doppelpunkt UND trennt
      // Datum/Zeit per Komma statt Leerzeichen; beides muss toleriert werden.
      var futA = allText.match(/N(?:ä|ae)chster\\s+Termin\\s*(?:\\([^)]*\\))?\\s*:?\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})[,\\s]+(\\d{2}):(\\d{2})/i);
      if (futA && isFuture(+futA[3], +futA[2], +futA[1])) {
        result.naechsterTerminDatum = futA[3] + '-' + futA[2] + '-' + futA[1];
        result.naechsterTerminZeit  = futA[4] + ':' + futA[5];
      }

      // Pattern b (frueher c2): Liris-Such-Suggestion-Format
      // "Fr. 12 Juni 2026, 07:15 (MPA)" - Wochentag + DD + deutscher
      // Monatsname + YYYY + HH:MM. Sehr eindeutiges, sauberes Format —
      // wird VOR der stoeranfaelligen ganzseitigen DD.MM.YYYY-Suche geprueft,
      // da diese leicht falsche/unzusammenhaengende Datum+Zeit-Paare findet.
      if (!result.naechsterTerminDatum) {
        var monthsDe = { Januar:1, Februar:2, 'März':3, Maerz:3, April:4, Mai:5, Juni:6,
                         Juli:7, August:8, September:9, Oktober:10, November:11, Dezember:12 };
        var reSugg = /(?:Mo|Di|Mi|Do|Fr|Sa|So)\\.?\\s+(\\d{1,2})\\.?\\s+(Januar|Februar|M(?:\\u00e4|ae)rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\\s+(\\d{4})\\s*,?\\s+(\\d{2}):(\\d{2})/gi;
        var bestSuggMs = Infinity, bestSugg = null, m5;
        while ((m5 = reSugg.exec(allText)) !== null) {
          var key = m5[2].charAt(0).toUpperCase() + m5[2].slice(1).toLowerCase().replace('ae','ä');
          var monIdx = monthsDe[key] || monthsDe[m5[2]];
          if (!monIdx) continue;
          if (!isFuture(+m5[3], monIdx, +m5[1])) continue;
          var msSugg = new Date(+m5[3], monIdx-1, +m5[1], +m5[4], +m5[5]).getTime();
          if (msSugg < bestSuggMs) { bestSuggMs = msSugg; bestSugg = { d: m5[1], mo: monIdx, y: m5[3], h: m5[4], min: m5[5] }; }
        }
        if (bestSugg) {
          var bestSuggDayNum = +bestSugg.d;
          var ddPad = (bestSuggDayNum < 10 ? '0' : '') + bestSuggDayNum;
          var moPad = (bestSugg.mo < 10 ? '0' : '') + bestSugg.mo;
          result.naechsterTerminDatum = bestSugg.y + '-' + moPad + '-' + ddPad;
          result.naechsterTerminZeit  = bestSugg.h + ':' + bestSugg.min;
        }
      }

      // Pattern c (frueher: unspezifische Ganzseiten-Suche nach IRGENDEINEM
      // DD.MM.YYYY HH:MM im Text) wurde ENTFERNT — sie hat faelschlicherweise
      // administrative Zeitstempel (z.B. "Aktualisiert am ...", "heute")
      // erwischt statt eines echten Termins. Lieber gar kein Datum uebernehmen
      // als ein falsches.

      // Pattern c2 (Liris-Zeitleiste, oberster Eintrag): "5W [Kalender-Icon]
      // 07.08.2026" bzw. "10T … 14.07.2026" — der oberste Zeitleisten-Eintrag
      // mit einem "<Zahl><Einheit>"-Badge (T=Tage, W=Wochen, M=Monate, J=Jahre
      // bis zum Termin) markiert eindeutig den naechsten kuenftigen Termin.
      // Keine Uhrzeit in diesem Element sichtbar — wird bewusst leer gelassen
      // statt geraten (MPA traegt sie manuell im Liris-Kalender ein).
      // Luecke zwischen Badge und Datum bewusst NICHT auf \\D beschraenkt:
      // das Kalender-Icon dazwischen kann als Ziffern-Ligatur (z.B. "11")
      // im extrahierten Text landen, was \\D faelschlich blockieren wuerde.
      if (!result.naechsterTerminDatum) {
        var wBadge = allText.match(/(\\d{1,3})\\s*[TWMJ]\\b[\\s\\S]{0,20}?(\\d{2})\\.(\\d{2})\\.(\\d{4})/);
        if (wBadge && isFuture(+wBadge[4], +wBadge[3], +wBadge[2])) {
          result.naechsterTerminDatum = wBadge[4] + '-' + wBadge[3] + '-' + wBadge[2];
          // Uhrzeit steht in der Zeitleiste nur im Hover-Tooltip (title-Attribut):
          // Element suchen, dessen Text ODER title das gefundene Datum enthaelt
          // und dessen title eine Uhrzeit HH:MM traegt.
          try {
            var deDate = wBadge[2] + '.' + wBadge[3] + '.' + wBadge[4];
            var tippedC2 = document.querySelectorAll('[title]');
            for (var tc = 0; tc < tippedC2.length; tc++) {
              var elC2 = tippedC2[tc];
              var tipC2 = (elC2.getAttribute('title') || '').trim();
              var tmC2 = tipC2.match(/(\\d{2}):(\\d{2})/);
              if (!tmC2) continue;
              var txtC2 = (elC2.textContent || '');
              if (txtC2.indexOf(deDate) !== -1 || tipC2.indexOf(deDate) !== -1) {
                result.naechsterTerminZeit = tmC2[1] + ':' + tmC2[2];
                break;
              }
            }
          } catch (e) { /* Tooltip-Zeit optional — Datum reicht als Minimum */ }
        }
      }

      // Pattern d (Liris-Timeline): blaues Kalender-Icon mit zukuenftigem
      // Datum im Text; Uhrzeit steht im title-Attribut eines benachbarten
      // Elements ("HH:MM" oder "DD.MM.YYYY HH:MM"). Wir scannen alle
      // Elemente mit title-Attribut, filtern auf zukuenftige Termine und
      // nehmen den naechstgelegenen.
      if (!result.naechsterTerminDatum) {
        try {
          var tipped = document.querySelectorAll('[title]');
          var bestTipMs = Infinity, bestDate = null, bestTime = null;
          for (var ti = 0; ti < tipped.length; ti++) {
            var el = tipped[ti];
            var tip = (el.getAttribute('title') || '').trim();
            var txtNode = (el.textContent || '').trim();
            // Datum kann im Text ODER im title stehen
            var dm = txtNode.match(/(\\d{2})\\.(\\d{2})\\.(\\d{4})/) || tip.match(/(\\d{2})\\.(\\d{2})\\.(\\d{4})/);
            if (!dm) continue;
            if (!isFuture(+dm[3], +dm[2], +dm[1])) continue;
            // Uhrzeit aus title
            var tm = tip.match(/(\\d{2}):(\\d{2})/);
            if (!tm) {
              // evtl. auf Nachbar-/Eltern-Element schauen
              var par = el.parentElement;
              if (par) {
                var ptip = par.getAttribute('title');
                if (ptip) tm = ptip.match(/(\\d{2}):(\\d{2})/);
              }
            }
            if (!tm) continue;
            var ms3 = new Date(+dm[3], +dm[2]-1, +dm[1], +tm[1], +tm[2]).getTime();
            if (ms3 < bestTipMs) {
              bestTipMs = ms3;
              bestDate = dm[3] + '-' + dm[2] + '-' + dm[1];
              bestTime = tm[1] + ':' + tm[2];
            }
          }
          if (bestDate) {
            result.naechsterTerminDatum = bestDate;
            result.naechsterTerminZeit  = bestTime;
          }
        } catch (e) { /* DOM-Zugriff fehlgeschlagen — fallback hat ggf. schon gegriffen */ }
      }

      // Pattern e (nur-Datum-Fallback, ohne Uhrzeit) wurde ENTFERNT — sie war
      // die groesste Fehlerquelle: sie griff das erste beliebige zukuenftige
      // Datum IRGENDWO auf der Seite (z.B. "Aktualisiert am", "heute") statt
      // eines echten Termins. Ohne Uhrzeit-Bezug war das nicht verlaesslich
      // von echten Terminen zu unterscheiden.

      // Zeit-Nachschlag (2026-07-19): Datum wurde gefunden, aber ohne Uhrzeit
      // (z.B. Zeitleisten-Badge ohne Tooltip-Zeit) — im Seitentext gezielt
      // nach GENAU diesem Datum gefolgt von einer Uhrzeit suchen. Der feste
      // Datums-Bezug verhindert die Fehlgriffe des alten Pattern e.
      if (result.naechsterTerminDatum && !result.naechsterTerminZeit) {
        var ntdParts = result.naechsterTerminDatum.split('-');
        var deDateNZ = ntdParts[2] + '\\\\.' + ntdParts[1] + '\\\\.' + ntdParts[0];
        var tAfter = allText.match(new RegExp(deDateNZ + '[\\\\s,]{0,5}(\\\\d{1,2}):(\\\\d{2})'));
        if (tAfter) {
          var hNZ = tAfter[1].length < 2 ? '0' + tAfter[1] : tAfter[1];
          result.naechsterTerminZeit = hNZ + ':' + tAfter[2];
        }
      }

      // 9) Beurteilung-und-Prozedere Keywords: 'Myd' -> Pupillenerweiterung,
      //    'OCT' -> OCT, etc. Wird vom Aufbieten-Formular konsumiert.
      var bpStart2 = allText.search(/Beurteilung\\s+und\\s+Prozedere/i);
      if (bpStart2 >= 0) {
        // 'Diagnose' steht als Nachbar-Spaltenheader oft direkt nach
        // 'Beurteilung und Prozedere' — NICHT als Abschnitt-Ende werten,
        // sonst wird der eigentliche Inhalt (mit Myd/OCT/Pachy) verpasst.
        var bpTxt = allText.slice(bpStart2, bpStart2 + 800);
        var bpEnd2 = bpTxt.search(/\\n\\s*(?:Anamnese|Befund|Untersuchung\\s+vom|Autor)\\b/i);
        if (bpEnd2 > 0) bpTxt = bpTxt.slice(0, bpEnd2);
        // Toleranter matchen — Liris-Kuerzel wie 'Mydr', 'OCT MP', 'Pachy'
        // (keine harten Wortgrenzen am Ende, damit Wortstaemme greifen).
        var kws = [];
        if (/\\bMyd/i.test(bpTxt))                                    kws.push('Myd');          // Myd, Mydr, Mydriasis
        if (/\\bOCT\\b|\\bOCT[- ]?MP\\b/i.test(bpTxt))               kws.push('OCT');          // OCT, OCT MP
        if (/\\bGF\\b|Gesichtsfeld|Perimetrie/i.test(bpTxt))         kws.push('GF');
        if (/Biometrie|\\bBiom/i.test(bpTxt))                        kws.push('Biometrie');
        if (/Pachy/i.test(bpTxt))                                    kws.push('Pachymetrie');  // Pachy, Pachymetrie
        if (/Hornhaut[- ]?Topographie|Topographie|\\bTopo/i.test(bpTxt)) kws.push('Topographie');
        if (/Tr(?:ä|ae)nenfilm/i.test(bpTxt))                        kws.push('Traenenfilm');
        if (/Funduskopie|\\bFundus/i.test(bpTxt))                    kws.push('Funduskopie');
        if (/Tonometrie|\\bTono\\b/i.test(bpTxt))                    kws.push('Tonometrie');
        if (/Zykloplegie|\\bZyklo/i.test(bpTxt))                     kws.push('Zykloplegie');
        result.bpKeywords = kws;
      }

      return result;
    })();
  `
  // Bis zu 3 Versuche mit zunehmender Wartezeit — Liris-Untersuchung kann
  // einige Sekunden brauchen bis sie fertig gerendert ist.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1200))
    }
    try {
      const res = await wv.executeJavaScript(script) as any
      if (res?.gebDatum || res?.autor || res?.letzteKons || res?.notFound || res?.vorname || res?.pidMatchesLiris || res?.intervalWeeks || res?.verstorben) {
        console.log('[Liris-Extract] attempt', attempt + 1, 'success:', res)
        return {
          pid,
          pidMatchesLiris: !!res.pidMatchesLiris,
          vorname:       res.vorname       ?? null,
          nachname:      res.nachname      ?? null,
          gebDatum:      res.gebDatum      ?? null,
          autor:         res.autor         ?? null,
          letzteKons:    res.letzteKons    ?? null,
          intervalWeeks: res.intervalWeeks ?? null,
          notFound:      !!res.notFound,
          verstorben:    !!res.verstorben,
          anrede:        res.anrede        ?? null,
          postAdresse:   res.postAdresse   ?? null,
          email:         res.email         ?? null,
          emailVerdaechtig: res.emailVerdaechtig ?? null,
          bpKeywords:    Array.isArray(res.bpKeywords) ? res.bpKeywords : [],
          naechsterTerminDatum: res.naechsterTerminDatum ?? null,
          naechsterTerminZeit:  res.naechsterTerminZeit  ?? null,
          naechsterTerminRaw:   res.naechsterTerminRaw   ?? null,
          bpText:              res.bpText               ?? null,
          zusKontaktName:      res.zusKontaktName       ?? null,
          zusKontaktAdresse:   res.zusKontaktAdresse    ?? null,
          zusKontaktTyp:       (res.zusKontaktTyp as 'vertreter' | 'kontaktperson' | null) ?? null,
        }
      }
      console.log('[Liris-Extract] attempt', attempt + 1, 'nothing yet, debug:', res?._debug)
    } catch (e) {
      console.warn('[Liris-Extract] attempt', attempt + 1, 'error:', e)
    }
  }
  console.warn('[Liris-Extract] all attempts failed')
  return null
}

export default function BrowserPanel() {
  const { isOpen, close, defaultUrl, pendingPid, clearPendingPid, setLirisExtract, requestRecallByPid, requestRecallNew, staleRecallPids, knownRecallPids, staleReferenceDate, setStaleReferenceDate, reloadLirisAt, setLirisWebContentsId, terminAnlegenRequest, clearTerminAnlegenRequest, lirisSuppressed, setLirisPanelWidth } = useBrowser()
  const toast = useToast()

  // WebContents-ID beim Unmount zuruecksetzen. Das Panel ist nur auf
  // /recall, /ivom und /zuweisung gemountet (siehe AppShell) — navigiert der
  // User z.B. zum Dashboard, wird das Webview zerstoert, aber die ID blieb
  // bisher stale im Context stehen. Der app-weite Postausgang startete dann
  // Auto-Uploads gegen ein nicht mehr existierendes Webview: openWithPid
  // lief ins Leere (kein Panel, keine PID-Injection) und der Upload scheiterte
  // nach ~20s Wartezeit mit "Patientenakte konnte nicht geoeffnet werden" —
  // die haeufigste Fehlerursache im error_log (Stand 2026-07-17). Mit
  // genullter ID wartet die Auto-Upload-Queue stattdessen sauber, bis der
  // User wieder auf einer Seite mit Liris-Panel ist.
  useEffect(() => () => setLirisWebContentsId(null), [setLirisWebContentsId])

  // External reload-Trigger (z.B. nach 'Als aufgeboten markieren') —
  // laedt das Liris-Webview neu, damit neue Termine sichtbar werden.
  useEffect(() => {
    if (reloadLirisAt === 0) return
    const wv = webviewRef.current as any
    if (wv?.reload) {
      try { wv.reload() } catch { /* no-op */ }
    }
  }, [reloadLirisAt])

  // 'Termin anlegen'-Vorbereitung: zum Terminkalender wechseln, im
  // rechten Panel den Patienten (per PID) suchen + auswaehlen und das
  // Grund-Feld mit den aus der Akte gelesenen Infos fuellen. Den Termin
  // selbst setzt der User manuell (Datum/Slot klicken).
  useEffect(() => {
    if (!terminAnlegenRequest) return
    if (Date.now() - terminAnlegenRequest.at > 15000) { clearTerminAnlegenRequest(); return }
    const { pid, grund } = terminAnlegenRequest
    const wv = webviewRef.current as any
    if (!wv?.executeJavaScript) return
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    ;(async () => {
      try {
        console.log('[TerminAnlegen] start, pid=', pid, 'grund=', grund)
        // 1) Auf das Patient-Suchfeld im 'Termin anlegen'-Panel warten. War der
        //    User z.B. in einer Akte statt im Terminkalender, existiert das
        //    Feld nicht — nach kurzer Wartezeit zur Liris-Startseite
        //    (=Terminkalender/Agenda) navigieren und danach weiter pollen.
        let fieldDa = false
        let navigatedHome = false
        for (let i = 0; i < 16 && !fieldDa; i++) {
          await sleep(450)
          fieldDa = await wv.executeJavaScript(`!!document.querySelector('input[placeholder*="atientensuche"]')`).catch(() => false)
          if (!fieldDa && !navigatedHome && i === 3) {
            navigatedHome = true
            // User ist z.B. in einer Patientenakte: zum Terminkalender springen.
            // 1) Bevorzugt Liris-INTERN navigieren (Kalender-/Home-Link klicken)
            //    — SPA-Routing, kein Reload, das Todo bleibt erhalten.
            const clicked = await wv.executeJavaScript(`(function(){
              var as = [].slice.call(document.querySelectorAll('a[href]'));
              var cand = as.find(function(a){
                var h = a.getAttribute('href') || '';
                return h === '/' || /agenda|calendar|termin/i.test(h);
              });
              if (cand) { cand.click(); return true; }
              return false;
            })()`).catch(() => false)
            console.log('[TerminAnlegen] Suchfeld nicht gefunden — Kalender-Link geklickt:', clicked)
            // 2) Fallback: harter Reload der Startseite (verliert SPA-State,
            //    aber besser als gar keine Navigation).
            if (!clicked && defaultUrl) {
              console.log('[TerminAnlegen] Kein Kalender-Link — lade Startseite hart neu')
              try { (wv as { loadURL?: (u: string) => Promise<void> }).loadURL?.(defaultUrl) } catch { /* ignore */ }
            }
            await sleep(1500) // Navigation + Nachladen abwarten, bevor weiter gepollt wird
          }
        }
        console.log('[TerminAnlegen] Patient-Feld da:', fieldDa)
        if (!fieldDa) {
          clearTerminAnlegenRequest()
          toast.warning('Liris-Terminkalender nicht gefunden — bitte manuell zum Terminkalender wechseln und «Termin anlegen» öffnen.')
          return
        }
        await sleep(600)
        // 3) Formular-Observer ZUERST: Falls Liris das Formular waehrend der
        //    Patientenauswahl versteckt, sofort wieder anzeigen.
        await wv.executeJavaScript(`(function(){
          // Finde den Formular-Container (mehrere Selektoren versuchen)
          var form = document.querySelector('[placeholder*="atientensuche"]')?.closest('form, .panel, [role="dialog"], .modal, .drawer, div[style*="display"]');
          if (!form) {
            // Fallback: suche nach sichtbaren großen DIVs die Inputs enthalten
            var candidates = document.querySelectorAll('div, section, aside');
            for (var i = 0; i < candidates.length; i++) {
              if (candidates[i].querySelector('input[placeholder*="atientensuche"]')) {
                form = candidates[i];
                break;
              }
            }
          }
          if (!form) return false;

          // MutationObserver: wenn display:none oder visibility:hidden gesetzt wird, entfernen
          var observer = new MutationObserver(function() {
            var style = window.getComputedStyle(form);
            if (style.display === 'none' || style.visibility === 'hidden') {
              form.style.display = '';
              form.style.visibility = '';
            }
          });
          observer.observe(form, { attributes: true, attributeFilter: ['style', 'class'] });
          window._terminFormObserver = observer; // speichern für cleanup
          return true;
        })()`)
        // 4) PID ins Patient-Feld setzen UND die Autocomplete-Auswahl
        //    tatsaechlich anklicken — ohne Klick auf den Dropdown-Treffer
        //    bindet Liris keinen Patienten an das Formular, auch wenn der
        //    Text im Feld steht (nur getippter Text != ausgewaehlter Patient).
        const pickResult = await wv.executeJavaScript(`(function(){
          var el = document.querySelector('input[placeholder*="atientensuche"]');
          if (!el) return 'no-input';
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          // Cache-Bust: erst leeren, dann tippen — erzwingt frische
          // Autocomplete-Abfrage (sonst zeigt Liris veraltete Termine).
          setter.call(el, '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function() {
            setter.call(el, ${JSON.stringify('#' + pid)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, 150);

          var pidStr = ${JSON.stringify(pid)};
          function isVisible(node) {
            if (!node || node.offsetParent === null) return false;
            var r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }
          function selectFirst() {
            var clickables = document.querySelectorAll('a, button, li, [role="option"], [role="button"], div[onclick], tr[onclick]');
            for (var k = 0; k < clickables.length; k++) {
              var c = clickables[k];
              if (!isVisible(c)) continue;
              var ownText = c.textContent || '';
              if (ownText.indexOf(pidStr) === -1) continue;
              if (c.tagName === 'INPUT' || c.contains(el)) continue;
              c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              c.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
              c.click();
              return true;
            }
            var itemSelectors = [
              '.ui-autocomplete li:first-child a', '.ui-autocomplete li:first-child',
              '.autocomplete-suggestion', '.dropdown-menu li:first-child a',
              '.dropdown-menu li:first-child', '[role="option"]', '.tt-suggestion',
              'ul.typeahead li:first-child'
            ];
            for (var i = 0; i < itemSelectors.length; i++) {
              var item = document.querySelector(itemSelectors[i]);
              if (item && isVisible(item)) {
                item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                item.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
                item.click();
                return true;
              }
            }
            return false;
          }

          return new Promise(function(resolve) {
            var tries = 0;
            var iv = setInterval(function() {
              tries++;
              if (selectFirst()) { clearInterval(iv); resolve('selected'); return; }
              if (tries >= 8) { clearInterval(iv); resolve('no-match'); }
            }, 350);
          });
        })()`).catch(() => 'error')
        console.log('[TerminAnlegen] Patient-Auswahl:', pickResult)
        if (pickResult !== 'selected') {
          toast.warning('Patient konnte im Terminkalender nicht automatisch ausgewählt werden — bitte manuell aus der Vorschlagsliste wählen.')
        }
        await sleep(300)
        // 4b) Vorschlagsliste wieder zuklappen: Nach der Auswahl bleibt das
        //     Autocomplete-Dropdown in Liris teils offen und verdeckt das
        //     Formular. WICHTIG: KEIN Escape/Blur — das wuerde die getroffene
        //     Patientenauswahl in Liris wieder loeschen. Stattdessen nur die
        //     sichtbaren Dropdown-Container ausblenden; die Auswahl bleibt.
        if (pickResult === 'selected') {
          await wv.executeJavaScript(`(function(){
            var sels = ['.ui-autocomplete', '.dropdown-menu', '.tt-menu', 'ul.typeahead'];
            var hidden = 0;
            for (var i = 0; i < sels.length; i++) {
              var m = document.querySelectorAll(sels[i]);
              for (var j = 0; j < m.length; j++) {
                if (m[j].offsetParent !== null) { m[j].style.display = 'none'; hidden++; }
              }
            }
            return hidden;
          })()`).catch(() => 0)
          console.log('[TerminAnlegen] Vorschlagsliste ausgeblendet (Auswahl bleibt bestehen)')
        }
        // 5) Grund-Feld nur fuellen wenn Liris NICHT selbst die gelbe
        //    Termin-Info-Box zeigt ('Naechster Termin (von ...): ...').
        const hasYellow = await wv.executeJavaScript(`/N(?:ä|ae)chster\\s+Termin\\s*\\(\\s*von/i.test(document.body?document.body.innerText:'')`).catch(() => false)
        console.log('[TerminAnlegen] gelbe Box vorhanden?', hasYellow)
        if (grund && !hasYellow) {
          const grundOk = await wv.executeJavaScript(`(function(){
            var el=document.querySelector('input[placeholder="Grund"], input[placeholder*="Grund"], textarea[placeholder*="Grund"]');
            if(!el) return false;
            el.focus();
            var proto = el.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            var set=Object.getOwnPropertyDescriptor(proto,'value').set;
            set.call(el, ${JSON.stringify(grund)});
            el.dispatchEvent(new Event('input',{bubbles:true}));
            el.dispatchEvent(new Event('change',{bubbles:true}));
            return true;
          })()`).catch(() => false)
          console.log('[TerminAnlegen] Grund gesetzt:', grundOk)
        }
      } catch (e) {
        console.warn('[TerminAnlegen] fehlgeschlagen:', e)
      } finally {
        clearTerminAnlegenRequest()
      }
    })()
  }, [terminAnlegenRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  const { user, isAdmin } = useAuth()
  // Pro-User Webview-Partition: jeder Mitarbeiter loggt sich selber bei
  // Liris ein. Die farbigen Recall-Markierungen werden per Injection
  // (siehe highlightRecallPids weiter unten) angewendet — sie funktionieren
  // unabhaengig davon welcher Liris-User aktuell eingeloggt ist.
  const partition = user?.uid ? `persist:liris-${user.uid}` : 'persist:liris-guest'
  const [inputUrl, setInputUrl] = useState(defaultUrl)
  const [currentUrl, setCurrentUrl] = useState(defaultUrl)
  const [loading, setLoading] = useState(false)
  // Anzahl im aktuellen Liris-View markierter (noch nicht aktualisierter) Patienten
  const [markStaleCount, setMarkStaleCount] = useState(0)
  const [markMissingCount, setMarkMissingCount] = useState(0)
  const [markIsAkte, setMarkIsAkte] = useState(false)   // Patienten-Akte offen (keine Tagesliste)
  // Markierte PIDs des letzten Scans (eindeutig). Werden pro Tag in dayHistory
  // gespeichert, damit die angezeigte Zahl live gegen die aktuellen offenen
  // Recall-PIDs berechnet werden kann (Selbstkorrektur beim Bearbeiten).
  const [markStalePids, setMarkStalePids] = useState<string[]>([])
  const [markMissingPids, setMarkMissingPids] = useState<string[]>([])
  const [dayHistory, setDayHistory] = useState<Record<string, { stalePids: string[]; missingPids: string[] }>>({})
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('liris-panel-width'))
    return saved >= 300 && saved <= 1200 ? saved : 480
  })
  const [collapsed, setCollapsed] = useState(false)  // schnell eingeklappt — Liris bleibt geladen
  const [resizing, setResizing] = useState(false)    // true während Breiten-Drag (Overlay über Webview)

  // Sichtbare Panel-Breite an den Context melden, damit App-Dialoge
  // (Patient bearbeiten) daneben statt darüber positioniert werden können.
  useEffect(() => {
    setLirisPanelWidth(collapsed ? 40 : width)
    return () => setLirisPanelWidth(0)
  }, [collapsed, width, setLirisPanelWidth])
  const resizeRafRef = useRef<number | null>(null)
  // Tastenkürzel Strg+L / Cmd+L: Liris ein-/ausklappen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        setCollapsed(c => !c)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const webviewRef   = useRef<HTMLElement>(null)
  const resizeRef    = useRef<{ startX: number; startW: number } | null>(null)
  const webviewReady = useRef(false)   // true sobald dom-ready einmal gefeuert hat
  const lastDetailPid = useRef<string | null>(null)  // zuletzt im Liris-Header erkannte PID
  const staleRecallPidsRef = useRef<string[]>([])   // wird unten via Effect synchron gehalten
  const knownRecallPidsRef = useRef<string[]>([])
  const staleRefDateRef    = useRef<string>(staleReferenceDate)
  const highlightRef       = useRef<(() => void) | null>(null)

  const navigate = useCallback((target: string) => {
    let url = target.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    setCurrentUrl(url)
    setInputUrl(url)
  }, [])

  // Webview-Blur-Workaround: Electron behaelt manchmal "Geist-Focus" im
  // webview, auch nachdem der User in der Host-App auf ein Input geklickt hat
  // — Folge: Tastatureingaben gehen ins Leere.
  // Fix 1: mousedown ausserhalb -> webview blurren.
  // Fix 2: nach dom-ready/did-navigate nimmt der Webview automatisch Fokus —
  //         auch wenn der User gerade im Host tippt. Deshalb nach Navigation
  //         ebenfalls blurren, sofern der letzte Klick NICHT im Webview war.
  const lastClickInWebview = useRef(false)
  // Zuletzt aktives Eingabefeld in der Host-App + Zeitpunkt des letzten
  // Tastendrucks darin — nur wenn der User GERADE aktiv tippt, gilt ein
  // Webview-Fokuswechsel als "Fokus-Klau" (Fix 3 unten).
  const lastHostInput = useRef<HTMLElement | null>(null)
  const lastHostTypingAt = useRef(0)
  // Zeitpunkt des letzten Fokus-Wechsels AUF ein Host-Eingabefeld (Klick in
  // ein Modal-Feld zaehlt auch OHNE Tippen) und des letzten Maus-Klicks IM
  // Liris-Gast (via injiziertem mousedown-Listener gemeldet — Host-Events
  // sehen Klicks im Webview nicht).
  const lastHostFocusAt = useRef(0)
  const lastGuestMouseAt = useRef(0)
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const wv = webviewRef.current
      if (!wv) return
      lastClickInWebview.current = wv.contains(e.target as Node)
      if (lastClickInWebview.current) return  // Klick IM webview -> nichts tun
      try { (wv as any).blur?.() } catch { /* ignore */ }
    }
    // Aktives Host-Eingabefeld merken (fuer Fokus-Rueckgabe).
    function onFocusIn(e: FocusEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      const wv = webviewRef.current
      if (wv && wv.contains(t)) return  // Fokus im Webview interessiert hier nicht
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
        lastHostInput.current = t
        lastHostFocusAt.current = Date.now()
      }
    }
    // Aktives Tippen in einem Host-Feld erfassen (Zeitstempel).
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      const wv = webviewRef.current
      if (wv && wv.contains(t)) return
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
        lastHostTypingAt.current = Date.now()
      }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  // Fix 3: Liris kann per eigenem JS den Fokus in den Webview ziehen — mitten
  // beim Tippen ODER direkt nachdem der User in ein Modal-Feld geklickt hat
  // (z.B. wenn die per openWithPid geladene Akte fertig laedt und Liris ein
  // Suchfeld autofokussiert). Bewusste Klicks INS Liris-Panel meldet der
  // injizierte Gast-Listener als '__AZ_MDOWN__' (Host-Events sehen Webview-
  // Klicks nicht). Entscheidung:
  //   - User tippte/fokussierte gerade ein Host-Feld -> sofort zurueckholen
  //   - sonst 250ms warten: kam ein Gast-Klick -> bewusster Wechsel, ok;
  //     kam keiner -> programmatischer Klau -> zurueckholen (sofern das
  //     zuletzt aktive Host-Feld noch existiert, d.h. ein Modal offen ist).
  useEffect(() => {
    if (!isOpen) return
    const wv = webviewRef.current as any
    if (!wv) return
    const reclaim = (prev: HTMLElement) => {
      try { wv.blur?.() } catch { /* ignore */ }
      // Fokus-Rueckgabe leicht verzoegert, da Electron den Webview-Fokus
      // asynchron setzt und ein sofortiges focus() sonst wieder ueberschrieben wird.
      window.setTimeout(() => {
        try { if (document.contains(prev)) prev.focus() } catch { /* ignore */ }
      }, 50)
    }
    const onWvFocus = () => {
      if (lastClickInWebview.current) return   // bewusster Klick in Liris -> Fokus dort lassen
      const prev = lastHostInput.current
      if (!prev || !document.contains(prev)) return  // kein Host-Feld (mehr) da -> nichts erzwingen
      const typed   = Date.now() - lastHostTypingAt.current < 1200
      const focused = Date.now() - lastHostFocusAt.current  < 800
      if (typed || focused) { reclaim(prev); return }
      // Unklar: Gast-Klick-Meldung kommt async leicht verzoegert — kurz warten.
      window.setTimeout(() => {
        if (Date.now() - lastGuestMouseAt.current < 700) return  // Klick in Liris -> ok
        if (!document.contains(prev)) return                     // Modal inzwischen zu
        reclaim(prev)
      }, 250)
    }
    wv.addEventListener('focus', onWvFocus)
    return () => wv.removeEventListener('focus', onWvFocus)
  }, [isOpen])

  // Blur nach Navigation: wenn letzter Klick im Host war, Fokus zurückgeben.
  const blurWebviewAfterNav = useCallback(() => {
    if (lastClickInWebview.current) return  // User hat zuletzt im Webview geklickt -> Fokus dort lassen
    const wv = webviewRef.current
    if (!wv) return
    // Kurze Verzögerung: Electron setzt Focus erst nach dom-ready async.
    window.setTimeout(() => {
      try { (wv as any).blur?.() } catch { /* ignore */ }
    }, 100)
  }, [])

  // Webview-Events binden (Navigation, Loading). Die frueher hier inject-ierte
  // Selection-Capture (mouseup -> setSelectedText) wurde entfernt: sie hat
  // bei jedem Markieren von Text in Liris (z.B. VEKA-Nr fuer Copy) den
  // Browser-Context aktualisiert -> alle Context-Subscriber (RecallPage etc.)
  // re-renderten. Das hat Eingabefelder im Patient-bearbeiten-Modal
  // zwischenzeitlich blockiert. User koennen weiterhin nativ via Ctrl+C in
  // der Webview kopieren — die Auto-Anzeige "Ausgewaehlt: ..." ist verzichtbar.
  useEffect(() => {
    if (!isOpen) return
    const wv = webviewRef.current as any
    if (!wv) return

    // executeJavaScript wirft SYNCHRON ("The WebView must be attached to the
    // DOM and the dom-ready event emitted"), wenn das Webview abgehaengt ist —
    // z.B. wenn nach Navigation zur Startseite noch Retry-Timer aus diesem
    // Panel feuern. Ein .catch() am Promise faengt das NICHT ab. Einmal
    // zentral wrappen: nicht angehaengt/nicht bereit -> still null liefern.
    // (Idempotent dank __azSafeExec-Flag; getWebContentsId analog.)
    if (!wv.__azSafeExec && typeof wv.executeJavaScript === 'function') {
      wv.__azSafeExec = true
      const origExec = wv.executeJavaScript.bind(wv)
      wv.executeJavaScript = (...args: unknown[]) => {
        try {
          if (!wv.isConnected) return Promise.resolve(null)
          return origExec(...args)
        } catch { return Promise.resolve(null) }
      }
      const origGetId = typeof wv.getWebContentsId === 'function' ? wv.getWebContentsId.bind(wv) : null
      if (origGetId) {
        wv.getWebContentsId = () => {
          try { return wv.isConnected ? origGetId() : null } catch { return null }
        }
      }
    }

    // Klick-Listener im Liris-Kalender: erkennt PID des angeklickten Patienten
    // und meldet sie via console.log('__AZ_PID__:<pid>') zurueck an den Host.
    // Sucht die PID im angeklickten Element und bis zu 8 Eltern-Ebenen:
    // zuerst im Text (#1234), dann in Attributen (data-pid, title, href, onclick…).
    const PID_CLICK_INJECT = `
      (function() {
        if (window.__azPidClick) return 'already';
        window.__azPidClick = true;
        // Jeden Maus-Klick im Liris-Gast an den Host melden — Host-seitige
        // Events sehen Klicks im Webview nicht; das Signal braucht die
        // Fokus-Wache um bewusste Klicks von Fokus-Klau zu unterscheiden.
        document.addEventListener('mousedown', function() {
          console.log('__AZ_MDOWN__');
        }, true);
        document.addEventListener('click', function(e) {
          var node = e.target;
          var pid = null;
          var markedKind = null; // 'stale' | 'missing' | null
          var rowEl = null;
          // Markierte Zeile separat erkennen — bis zu 8 Ebenen hoch, damit
          // ein Klick auf ein tiefes Kind-Element trotzdem die Markierung
          // identifizieren kann. (Die Pattern-Suche ist drunter strenger.)
          {
            var markNode = node;
            for (var mk = 0; mk < 8 && markNode; mk++) {
              if (markNode.getAttribute && markNode.getAttribute('data-az-recall-pid')) {
                if (markNode.classList && markNode.classList.contains('az-recall-row-missing')) markedKind = 'missing';
                else if (markNode.classList && markNode.classList.contains('az-recall-row-stale')) markedKind = 'stale';
                rowEl = markNode;
                // Die PID aus dem Markierungs-Attribut lesen — sicherer als
                // sie aus dem (evtl. trunkierten) Text zu fischen.
                pid = markNode.getAttribute('data-az-recall-pid');
                break;
              }
              markNode = markNode.parentElement;
            }
          }
          // Wenn Markierung erkannt + PID schon da, direkt verzweigen
          if (markedKind && pid) {
            if (markedKind === 'missing') {
              var rowTxtM = (rowEl && rowEl.textContent) || '';
              var nameMatchM = rowTxtM.match(/([A-Z\\u00c4\\u00d6\\u00dc][\\wA-Z\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc'-]+(?:\\s+[A-Z\\u00c4\\u00d6\\u00dc][\\wA-Z\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc'-]+)*)\\s+@\\d{2}:\\d{2}/);
              var nameM = nameMatchM ? nameMatchM[1].trim() : '';
              var gebMatchM = rowTxtM.match(/(\\d{2})\\.(\\d{2})\\.(\\d{4})/);
              var gebM = gebMatchM ? (gebMatchM[3] + '-' + gebMatchM[2] + '-' + gebMatchM[1]) : '';
              console.log('__AZ_PID_NEW__:' + JSON.stringify({ pid: pid, name: nameM, geb: gebM }));
            }
            // stale-Markierung -> wie zuvor nichts tun (manuell)
            return;
          }
          // Maximal 3 Ebenen hochlaufen — sonst springen Klicks auf
          // Header/Filter/Sidebar willkuerlich auf irgendeinen Patient.
          for (var i = 0; i < 3 && node; i++) {
            var txt = (node.textContent || '');
            // 1a) Klick auf eine konkrete Patient-Zeile (Kalender-Tagesplan).
            //     textContent <= 150 + genau ein @HH:MM = sicher eine einzelne
            //     Patient-Row, nicht ein groesserer Container.
            if (txt.length <= 150) {
              var times = txt.match(/@\\d{2}:\\d{2}/g);
              if (times && times.length === 1) {
                var m = txt.match(/#\\s*(\\d{1,7})(?!\\d)(?=\\s+\\d{2}\\.\\d{2}\\.\\d{4})/);
                if (m) { pid = m[1]; if (!rowEl) rowEl = node; break; }
              }
            }
            // 1b) Klick auf den Patient-Detail-Header (Name + Geburtsdatum +
            //     "(NN Jahre)"). Nur akzeptieren wenn die geklickte Stelle
            //     SELBST das Muster enthaelt — keine Suche im Body, sonst
            //     loest jeder Klick auf der Detail-Seite einen Auto-Open aus.
            if (txt.length <= 150 && /\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\(\\s*\\d+\\s*Jahre?\\s*\\)/.test(txt)) {
              var fullTxt = (document.body && document.body.innerText) || '';
              var ageAnchors = fullTxt.match(/\\(\\s*\\d+\\s*Jahre?\\s*\\)/g);
              if (ageAnchors && ageAnchors.length === 1) {
                var hm = fullTxt.match(/\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\(\\s*\\d+\\s*Jahre?\\s*\\)[^\\n#]{0,150}#\\s*0*(\\d{1,7})(?!\\d)/);
                if (hm) { pid = hm[1]; if (!rowEl) rowEl = node; break; }
              }
            }
            // 2) Attribute durchsuchen (nur explizite Patient-Attribute).
            if (node.getAttribute) {
              var attrs = ['data-pid','data-patient','data-patientid','data-patid'];
              for (var a = 0; a < attrs.length; a++) {
                var v = node.getAttribute(attrs[a]);
                if (v) {
                  var am = String(v).match(/(\\d{1,7})/);
                  if (am) { pid = am[1]; break; }
                }
              }
              if (pid) break;
            }
            node = node.parentElement;
          }
          if (!pid) return;
          if (markedKind === 'missing') {
            // Patient nicht im Recall -> NEU-Erfassung mit vorbefuellten Daten
            // (PID + Name + Geb.datum aus der Liris-Zeile, soweit erkennbar).
            var rowTxt = (rowEl && rowEl.textContent) || '';
            var nameMatch = rowTxt.match(/([A-Z\\u00c4\\u00d6\\u00dc][\\wA-Z\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc'-]+(?:\\s+[A-Z\\u00c4\\u00d6\\u00dc][\\wA-Z\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc'-]+)*)\\s+@\\d{2}:\\d{2}/);
            var name = nameMatch ? nameMatch[1].trim() : '';
            var gebMatch = rowTxt.match(/(\\d{2})\\.(\\d{2})\\.(\\d{4})/);
            var geb = gebMatch ? (gebMatch[3] + '-' + gebMatch[2] + '-' + gebMatch[1]) : '';
            console.log('__AZ_PID_NEW__:' + JSON.stringify({ pid: pid, name: name, geb: geb }));
          } else if (markedKind === 'stale') {
            // Markierte (zu aktualisierende) Zeilen NICHT auto-oeffnen — User klickt manuell.
            return;
          } else {
            // Unmarkierter Klick -> normales Recall-Lookup
            console.log('__AZ_PID__:' + pid);
          }
        }, true);

        // (Früher wurde hier CSS injiziert, um die Form-Section oben zu fixieren —
        //  das liess #cal-event-edit (Formular) jedoch auf Höhe 0 kollabieren und
        //  blieb dauerhaft in der Liris-Seite hängen → nur Kalender sichtbar.
        //  Entfernt. Zur Sicherheit ein evtl. früher injiziertes Style-Tag löschen.)
        var oldCss = document.getElementById('__az_form_css');
        if (oldCss && oldCss.parentNode) oldCss.parentNode.removeChild(oldCss);

        return 'injected';
      })();
    `

    // Liest die PID aus dem Patienten-Detail-Header von Liris.
    // Header-Muster: "Herr Keller Peter , 10.12.1958 (67 Jahre) , Buchs AG … #05162"
    // Die PID (#NNNNN) wird nur akzeptiert wenn sie nach "(NN Jahre)" steht —
    // so wird sie eindeutig dem geoeffneten Patienten zugeordnet.
    // Patient-PID aus dem Liris-Header lesen. Heuristik:
    // 1) Suche im 300-Zeichen-Fenster nach "(NN Jahre)".
    // 2) Sammle ALLE #NN-Vorkommen in diesem Fenster.
    // 3) Waehle die laengste Zahl — echte PIDs sind typischerweise laenger
    //    als sonstige #-Werte (Tarifnummern, Positionen, etc.) die nahebei
    //    erscheinen koennen. Bei Gleichstand wird die erste genommen.
    // Strenges Pattern fuer den Liris-Detail-Header:
    //   "DD.MM.YYYY (NN Jahre) ... #PID"
    // alles im SELBEN Textabschnitt — keine Zeilenumbrueche, kein
    // weiteres '#' dazwischen. Damit werden Kalenderwochen-Indikatoren
    // (z.B. "#24" im Tab-Strip oben) zuverlaessig ausgeschlossen.
    // Zusaetzlich: nur ein einziges "(NN Jahre)"-Vorkommen erlaubt
    // (sonst sind wir in einer Listenansicht).
    const DETAIL_PID_SCRIPT = `
      (function() {
        var txt = document.body ? (document.body.innerText || '') : '';
        var anchors = txt.match(/\\(\\s*\\d+\\s*Jahre?\\s*\\)/g);
        if (!anchors || anchors.length !== 1) return null;
        var headerRe = /\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\(\\s*\\d+\\s*Jahre?\\s*\\)[^\\n#]{0,150}#\\s*0*(\\d+)(?!\\d)/;
        var m = txt.match(headerRe);
        return m ? m[1] : null;
      })();
    `
    // Prueft den Detail-Header und oeffnet bei NEUER PID das Recall-
    // Bearbeiten-Popup automatisch. Wird nur bei echter Navigation
    // (dom-ready / did-navigate) aufgerufen, NICHT im Polling — sonst
    // feuert es bei jedem AJAX-Tick. Zusaetzlich werden Detail-Infos
    // (Intervall, Geburtsdatum, letzte Kons.) extrahiert damit das
    // Edit-Popup direkt vorausgefuellt werden kann.
    const checkDetailPid = () => {
      wv.executeJavaScript(DETAIL_PID_SCRIPT).then((pid: string | null) => {
        if (!pid) return
        if (pid !== lastDetailPid.current) {
          lastDetailPid.current = pid
          console.log('[Liris] Patient-Detail geoeffnet, PID=', pid)
          // Erst Extract starten, dann requestRecallByPid — RecallPage
          // konsumiert beides parallel; lirisExtract ist fuer Auto-Fill
          // bei bestehendem und neuem Eintrag.
          extractLirisInfo(wv, '#' + pid).then(info => {
            if (info) {
              console.log('[Liris] Detail-Extract:', info)
              // pidMatchesLiris + notFound erzwingen: die PID wurde soeben
              // aus dem Liris-Header gelesen — der Patient IST vorhanden.
              // Der Extract kann trotzdem false liefern wenn die Seite noch
              // nicht fertig geladen ist.
              setLirisExtract({ ...info, pidMatchesLiris: true, notFound: false, at: Date.now() })
            }
          }).catch(() => {})
          // auto=true: Beim blossen Navigieren auf eine Akte oeffnet RecallPage
          // das Bearbeiten-Popup nur noch, wenn es dort etwas Neues gibt
          // (neue Konsultation, †-Markierung, Patient fehlt im Recall).
          requestRecallByPid(pid, true)
        }
      }).catch(() => {})
    }
    // Mehrere Versuche, da die Detailseite asynchron nachlaedt.
    const scheduleDetailCheck = () => {
      [500, 1200, 2200].forEach(ms => window.setTimeout(checkDetailPid, ms))
    }

    // Liest das im Liris-Kalender-Header sichtbare Tagesdatum
    // (z.B. "Mi. 20/05" oder "20.05.2026"). Gibt ISO YYYY-MM-DD zurueck
    // (Jahr ggf. aus aktuellem Jahr ergaenzt). Wird nach jeder Navigation
    // ausgefuehrt damit das stale-Referenzdatum dem gezeigten Tag folgt.
    const CALENDAR_DAY_SCRIPT = `
      (function() {
        var txt = document.body ? (document.body.textContent || '') : '';
        // YYYY#KW-Marker vorab lesen — Liris zeigt ihn wenn das angezeigte
        // Jahr vom laufenden abweicht. Ist zuverlaessiger als ein zufaellig
        // gematchtes Datum mit Jahreszahl (z.B. heutiges Datum im Header).
        var yrMarker = txt.match(/(?:^|[^\\d])((?:19|20)\\d{2})\\s*#\\s*\\d{1,2}(?!\\d)/);
        var markerYear = yrMarker ? parseInt(yrMarker[1], 10) : null;
        // Prio 1: Patienten-Akte offen -> "Untersuchung vom DD.MM.YYYY"
        var m = txt.match(/Untersuchung\\s+vom\\s+(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})/i);
        // Prio 2: Kalender-Tagesheader "Mi. 20/05" / "Mi 20.05.2026"
        if (!m) m = txt.match(/(?:Mo|Di|Mi|Do|Fr|Sa|So)\\.?\\s+(\\d{1,2})[\\/.](\\d{1,2})(?:[\\/.](\\d{2,4}))?/);
        // Prio 3: irgendein DD.MM.YYYY auf der Seite (Fallback)
        // Nur Jahre 1990-2099 akzeptieren, um alte Geburtsdaten auszuschliessen
        if (!m) {
          var all = txt.match(/(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})/);
          if (all) {
            var y = parseInt(all[3], 10);
            if (y >= 1990 && y <= 2099) m = all;
          }
        }
        if (!m) return null;
        var dd = parseInt(m[1], 10);
        var mm = parseInt(m[2], 10);
        var yy = m[3] ? parseInt(m[3], 10) : null;
        // YYYY#KW-Marker hat Vorrang — er zeigt das Jahr der aktuellen
        // Kalenderansicht, waehrend ein gematchtes Datum von einem Header
        // oder Footer stammen kann (z.B. heutiges Datum = 2026 obwohl
        // der Kalender 2025 anzeigt).
        if (markerYear) yy = markerYear;
        if (yy === null) yy = new Date().getFullYear();
        if (yy < 100) yy += 2000;
        if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
        function p(n){return n<10?'0'+n:''+n;}
        return yy + '-' + p(mm) + '-' + p(dd);
      })();
    `
    const checkCalendarDay = () => {
      wv.executeJavaScript(CALENDAR_DAY_SCRIPT).then((iso: string | null) => {
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          // Blaettert der User im Liris-Kalender in die Zukunft, soll das NICHT
          // als Referenzdatum uebernommen werden — sonst wuerden kuenftige
          // Termine als "nicht aktualisiert" markiert, obwohl das irrelevant
          // ist (der Patient ist ja noch gar nicht faellig). Zukuenftige Tage
          // einfach ignorieren; das zuletzt bekannte (heutige/vergangene)
          // Referenzdatum bleibt bestehen.
          const todayIsoNow = new Date().toISOString().slice(0, 10)
          if (iso > todayIsoNow) return
          setStaleReferenceDate(iso)
        }
      }).catch(() => {})
    }
    const scheduleCalendarDayCheck = () => {
      [400, 1000, 2000].forEach(ms => window.setTimeout(checkCalendarDay, ms))
    }

    const onDomReady = () => {
      setLoading(false)
      webviewReady.current = true
      blurWebviewAfterNav()
      // WebContents-ID des Webviews fuer CDP-Upload bereitstellen
      try { if (wv.getWebContentsId) setLirisWebContentsId(wv.getWebContentsId()) } catch { /* no-op */ }
      wv.executeJavaScript(PID_CLICK_INJECT).catch(() => {})
      scheduleDetailCheck()
      scheduleCalendarDayCheck()
      scheduleRecallHighlight()
    }
    const onConsole = (e: any) => {
      const msg = e?.message || ''
      if (msg === '__AZ_MDOWN__') {
        // Klick im Liris-Gast: als bewusste Webview-Interaktion merken —
        // die Fokus-Wache laesst den Fokus dann in Liris.
        lastGuestMouseAt.current = Date.now()
        lastClickInWebview.current = true
        return
      }
      if (msg.indexOf('__AZ_PID__:') === 0) {
        const pid = msg.slice('__AZ_PID__:'.length).trim()
        if (pid) {
          console.log('[Liris] Patient im Kalender angeklickt, PID=', pid)
          requestRecallByPid(pid)
        }
      } else if (msg.indexOf('__AZ_PID_NEW__:') === 0) {
        try {
          const payload = JSON.parse(msg.slice('__AZ_PID_NEW__:'.length).trim())
          if (payload && payload.pid) {
            console.log('[Liris] Neu-Erfassung angefordert:', payload)
            requestRecallNew(payload)
          }
        } catch { /* ignore */ }
      }
    }
    const onDidNavigate = (e: any) => {
      if (e.url) setInputUrl(e.url)
      setLoading(false)
      blurWebviewAfterNav()
      // Nach echter Navigation Detail-PID-Merker zuruecksetzen, damit derselbe
      // Patient nach Wechsel und Rueckkehr wieder als "neu" zaehlt.
      lastDetailPid.current = null
      // Nach Navigation neu injizieren (window-Flag ist auf neuer Seite weg)
      wv.executeJavaScript(PID_CLICK_INJECT).catch(() => {})
      // Detail-Header pruefen — neuer Patient geoeffnet?
      scheduleDetailCheck()
      // Aktuell gezeigten Kalendertag erkennen
      scheduleCalendarDayCheck()
      // Recall-PIDs neu markieren
      scheduleRecallHighlight()
    }

    // PIDs hervorheben. Wird nach jeder Navigation/Refresh ausgeloest;
    // mehrere Retries weil Liris seine Tabellen oft asynchron rendert.
    // Mehrfach-Anwendung wird ueber data-Attribut idempotent gemacht.
    const scheduleRecallHighlight = () => {
      [300, 700, 1500, 3000, 5000, 8000].forEach(ms => window.setTimeout(highlightRecallPids, ms))
    }
    const highlightRecallPids = () => {
      const stalePids = staleRecallPidsRef.current
      const knownPids = knownRecallPidsRef.current
      if (!stalePids.length && !knownPids.length) return
      const refDate = staleRefDateRef.current
      const refDisplay = refDate ? refDate.split('-').reverse().join('.') : ''
      const tooltipStale  = `Recall seit ${refDisplay} nicht aktualisiert`
      const tooltipMissing = 'Patient ist nicht im Recall erfasst — noch aufzunehmen'
      const script = `
        (function() {
          var STALE = ${JSON.stringify(stalePids)};
          var KNOWN = ${JSON.stringify(knownPids)};
          var T_STALE   = ${JSON.stringify(tooltipStale)};
          var T_MISSING = ${JSON.stringify(tooltipMissing)};
          var staleSet = {}; for (var i=0; i<STALE.length; i++) staleSet[STALE[i]] = true;
          var knownSet = {}; for (var j=0; j<KNOWN.length; j++) knownSet[KNOWN[j]] = true;
          // Bestehende Markierungen: nur entfernen wenn PID jetzt OK ist.
          var oldRows = document.querySelectorAll('[data-az-recall-pid]');
          oldRows.forEach(function(el){
            var p = el.getAttribute('data-az-recall-pid');
            if (staleSet[p] || !knownSet[p]) return;
            el.removeAttribute('data-az-recall-pid');
            el.classList.remove('az-recall-row-stale','az-recall-row-missing');
            if (el.dataset.azRecallTitle) { el.removeAttribute('title'); delete el.dataset.azRecallTitle; }
          });
          // Legacy-Spans entfernen (aeltere Bundle-Versionen).
          var oldSpans = document.querySelectorAll('.az-recall-stale,.az-recall-missing');
          oldSpans.forEach(function(el){var p=el.parentNode;if(p){p.replaceChild(document.createTextNode(el.textContent),el);p.normalize();}});
          // Alt-Last entfernen: früher injiziertes Layout-CSS liess den
          // Termin-Formularbereich (#cal-event-edit) auf Höhe 0 kollabieren und
          // blieb in der Liris-Seite hängen. Hier proaktiv löschen (ohne Reload).
          var __legacyFormCss = document.getElementById('__az_form_css');
          if (__legacyFormCss && __legacyFormCss.parentNode) __legacyFormCss.parentNode.removeChild(__legacyFormCss);
          // Alt-Last: ein evtl. früher von uns gesetztes inline display:none auf
          // Liris-Such-/Termin-Formularen wieder aufheben (sonst bleibt das
          // «Termin bearbeiten»-Formular bis zum Reload zugeklappt).
          ['input[name="pirca-search"]','input[placeholder*="atientensuche"]'].forEach(function(sel){
            var inp = document.querySelector(sel);
            if(inp){ var box = inp.closest ? inp.closest('form, .search') : null; if(box && box.style && box.style.display === 'none') box.style.display = ''; }
          });
          // CSS sicherstellen
          if (!document.getElementById('__az_recall_css')) {
            var st = document.createElement('style');
            st.id = '__az_recall_css';
            st.textContent =
              // INNEN liegender Rahmen (box-shadow inset) statt outline: wird
              // innerhalb der Zeile gezeichnet und kann daher NICHT von
              // benachbarten markierten Zeilen ueberlappt/uebermalt werden →
              // jede markierte Zeile hat denselben sauberen Rahmen + Tint.
              // KEIN position:relative hier — FullCalendar positioniert Termine
              // per position:absolute innerhalb des Zeitraster; ein erzwungenes
              // position:relative reisst sie aus dem Grid und verzerrt die
              // gesamte Tagesansicht. box-shadow/z-index brauchen keine eigene
              // Positionierung, wirken auch auf bereits absolut positionierte Elemente.
              '.az-recall-row-stale{box-shadow:inset 0 0 0 3px #ff6600 !important;z-index:9999 !important;}'+
              '.az-recall-row-missing{box-shadow:inset 0 0 0 3px #0055ff !important;z-index:9999 !important;}'+
              '[data-az-recall-pid] [data-az-recall-pid]{box-shadow:none !important;background-color:transparent !important;}';
            document.documentElement.appendChild(st);
          }
          // TreeWalker: alle Text-Nodes mit '#' scannen
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function(n) {
              if (!n.nodeValue || n.nodeValue.indexOf('#') < 0) return NodeFilter.FILTER_REJECT;
              var p = n.parentNode;
              if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
          });
          var nodes = []; var n; while ((n = walker.nextNode())) nodes.push(n);
          var re = /#\\s*0*(\\d+)(?!\\d)(?=\\s+\\d{2}\\.\\d{2}\\.\\d{4})/g;
          function findRow(node) {
            var el = node.parentElement;
            // Nur die ERSTE (minimale) Ebene akzeptieren, die echte Patienten-Zeile ist
            for (var lvl = 0; lvl < 8 && el; lvl++) {
              // Liris-Kalender-Event-Block bevorzugen (ganzer Block)
              if (el.tagName === 'A' && el.classList && (el.classList.contains('cal-event') || el.classList.contains('fc-time-grid-event'))) {
                return el;
              }
              var t = el.textContent || '';
              var times = t.match(/@\\d{2}:\\d{2}/g);
              var hasPid = /#\\s*\\d/.test(t);
              var hasGeb = /\\d{2}\\.\\d{2}\\.\\d{4}/.test(t);
              // Nachname steht in Liris in GROSSBUCHSTABEN (z.B. "PUMA TORIERI"),
              // oft auf einer eigenen Zeile getrennt von Zeit/PID/Geburtsdatum.
              // Diese Bedingung verlangt, dass das Element AUCH den Namen enthält,
              // damit die Schleife bis zum vollen Patienten-Block hochsteigt und
              // die Umrandung Name + Vorname mit umschliesst (sonst nur die
              // PID-Zeile -> kaum sichtbar).
              var hasName = /[A-Z\\u00c4\\u00d6\\u00dc]{2,}/.test(t);
              // Akzeptiere nur kleine Elemente (Patienten-Zeilen), nicht große Container
              if (hasPid && hasGeb && hasName && times && times.length === 1 && t.length < 350) {
                return el; // Sofort zurückgeben, nicht weiter hochgehen
              }
              el = el.parentElement;
            }
            return node.parentElement;
          }
          nodes.forEach(function(node) {
            var txt = node.nodeValue;
            re.lastIndex = 0;
            var m, kind = null, pid = null;
            while ((m = re.exec(txt)) !== null) {
              var p = m[1];
              if (staleSet[p]) { kind = 'stale'; pid = p; break; }
              if (!knownSet[p]) { kind = 'missing'; pid = p; break; }
              // Aktualisierte Patienten (in knownSet aber nicht in staleSet) nicht markieren
            }
            if (!kind) return; // Kein Markierungsbedarf
            var row = findRow(node);
            if (!row || row.getAttribute('data-az-recall-pid')) return;
            row.setAttribute('data-az-recall-pid', pid);
            row.classList.add(kind === 'stale' ? 'az-recall-row-stale' : 'az-recall-row-missing');
            if (!row.getAttribute('title')) {
              row.setAttribute('title', kind === 'stale' ? T_STALE : T_MISSING);
              row.dataset.azRecallTitle = '1';
            }
          });
          // Nur echte Patient-Zeilen markieren: müssen ALL DIESE haben
          // - Name (Großbuchstaben)
          // - Zeit (@HH:MM)
          // - PID (#NNNNN)
          // - Geburtsdatum (DD.MM.YYYY)
          var pidNodes = document.querySelectorAll('tr, li, div[role="row"], a.cal-event, a.fc-time-grid-event');
          pidNodes.forEach(function(row){
            if(row.getAttribute('data-az-recall-pid')) return; // schon markiert
            var txt = (row.textContent || '').trim();
            if(!txt || txt.length > 500) return;

            // Überprüfe: HAT ALLE KRITERIEN?
            var hasTime = /@\\d{2}:\\d{2}/.test(txt);           // Zeit @HH:MM
            var hasGeburtsdatum = /\\d{2}\\.\\d{2}\\.\\d{4}/.test(txt); // Geb.datum DD.MM.YYYY
            var hasPid = /#\\s*0*(\\d+)(?!\\d)/.test(txt);      // PID #NNNNN
            var hasName = /[A-ZÄÖÜ][a-zäöü]/.test(txt);         // Name mit Großbuchstaben

            if(!hasTime || !hasGeburtsdatum || !hasPid || !hasName) return; // keine echte Patient-Zeile

            // PID extrahieren
            var pidMatch = txt.match(/#\\s*0*(\\d+)(?!\\d)/);
            if(!pidMatch) return;
            var pidStr = pidMatch[1];

            // Überprüfe: in DB und aktuell, veraltet, oder neu?
            var inStale = staleSet[pidStr];
            var inKnown = knownSet[pidStr];

            // Nur markieren wenn veraltet (orange) oder neu (rot)
            // Aktualisierte Patienten (inKnown && !inStale) werden nicht markiert
            var kind = null;
            if (inStale) { kind = 'stale'; }
            else if (!inKnown) { kind = 'missing'; }

            if (!kind) return; // Kein Markierungsbedarf

            // Verschachtelung vermeiden: wenn ein Vorfahre ODER Nachfahre
            // bereits fuer dieselbe PID markiert ist, NICHT erneut markieren.
            // Sonst werden z.B. <tr> UND ein darin liegendes div[role=row]
            // beide markiert -> derselbe Patient doppelt gezaehlt.
            if (row.closest('[data-az-recall-pid="'+pidStr+'"]')) return;
            if (row.querySelector('[data-az-recall-pid="'+pidStr+'"]')) return;

            row.setAttribute('data-az-recall-pid', pidStr);
            row.classList.add(kind === 'stale' ? 'az-recall-row-stale' : 'az-recall-row-missing');
            if(!row.getAttribute('title')) row.setAttribute('title', kind === 'stale' ? T_STALE : T_MISSING);
          });

          // Anzahl der aktuell markierten (noch nicht aktualisierten)
          // Patienten zuruecksenden -> Host zeigt eine Meldung im Panel-Kopf.
          // WICHTIG: nach eindeutiger PID zaehlen, nicht nach DOM-Elementen.
          // Ein Patient kann in mehreren Elementen (verschachtelt oder mehrere
          // Termine am selben Tag) auftauchen -> sonst zu hohe Zahl.
          var stalePids = {}, missPids = {};
          document.querySelectorAll('.az-recall-row-stale').forEach(function(el){
            var p = el.getAttribute('data-az-recall-pid'); if (p) stalePids[p] = 1;
          });
          document.querySelectorAll('.az-recall-row-missing').forEach(function(el){
            var p = el.getAttribute('data-az-recall-pid'); if (p) missPids[p] = 1;
          });
          var staleList = Object.keys(stalePids);
          var missList  = Object.keys(missPids);
          // Patienten-Akte offen? (kein Tageskalender mit Liste) -> dann den
          // Tageszaehler NICHT veraendern, damit die Backlog-Meldung weiter steht.
          var isAkte = /Untersuchung\\s+vom\\s+\\d/i.test(document.body ? (document.body.innerText || '') : '');
          return { stale: staleList.length, missing: missList.length, stalePids: staleList, missingPids: missList, isAkte: isAkte };
        })();
      `
      wv.executeJavaScript(script).then(function(r: any) {
        if (r && typeof r === 'object') {
          setMarkStaleCount(r.stale || 0)
          setMarkMissingCount(r.missing || 0)
          setMarkStalePids(Array.isArray(r.stalePids) ? r.stalePids : [])
          setMarkMissingPids(Array.isArray(r.missingPids) ? r.missingPids : [])
          setMarkIsAkte(!!r.isAkte)
        }
      }).catch(() => {})
    }
    highlightRef.current = highlightRecallPids
    const onLoadStart = () => setLoading(true)
    const onLoadStop  = () => setLoading(false)

    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('did-navigate', onDidNavigate)
    wv.addEventListener('did-navigate-in-page', onDidNavigate)
    wv.addEventListener('did-start-loading', onLoadStart)
    wv.addEventListener('did-stop-loading', onLoadStop)

    // Liris wechselt Tag-/Wochen-/Monatsansicht oft per AJAX, ohne dass
    // did-navigate feuert. Daher zusaetzlich alle 2.5s pruefen ob sich
    // das Kalender-Datum geaendert hat und ggf. Highlights neu setzen.
    // checkDetailPid LAEUFT BEWUSST NICHT IM POLLING — sonst feuert beim
    // Klick im Liris (waehrend ein Recall-Modal offen ist) alle 2.5s der
    // Mismatch-/Auto-Fill-Effect, was zu wiederholt aufpoppenden Meldungen
    // fuehrt. Detail-Extract laeuft nur bei echter Navigation/dom-ready.
    // (Früher: toggleGlobalSearch — blendete redundante Liris-Suchfelder per
    //  closest('form') aus. Das hat jedoch das ganze «Termin bearbeiten»-Formular
    //  mit ausgeblendet (das Patientensuche-Feld liegt im selben Formular) →
    //  Formular klappte alle 3 s zu. Entfernt; rein kosmetischer Nutzen.)

    const poll = window.setInterval(() => {
      // Polling laeuft auch bevor dom-ready einmal gefeuert hat — Liris
      // koennte gerade die Login-Seite anzeigen und dabei eine andere
      // dom-ready-Sequenz benutzen. executeJavaScript schlaegt einfach
      // still fehl wenn die Seite noch nicht bereit ist.
      // 3s statt 1.5s — halbiert die Webview-IPC-Last. highlightRecallPids
      // hat zusaetzlich einen Dirty-Check (laeuft nur bei Aenderungen).
      checkCalendarDay()
      highlightRecallPids()
    }, 3000)

    return () => {
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('did-navigate', onDidNavigate)
      wv.removeEventListener('did-navigate-in-page', onDidNavigate)
      wv.removeEventListener('did-start-loading', onLoadStart)
      wv.removeEventListener('did-stop-loading', onLoadStop)
      window.clearInterval(poll)
    }
  }, [isOpen, requestRecallByPid, setStaleReferenceDate])

  // Recall-PIDs in Refs spiegeln (der Poll liest daraus) UND bei Aenderung
  // sofort einen Highlight-Pass anstossen. Der Poll uebernimmt ab dann alle 3s.
  useEffect(() => {
    staleRecallPidsRef.current = staleRecallPids
    knownRecallPidsRef.current = knownRecallPids
    staleRefDateRef.current    = staleReferenceDate
    // Sofort highlighten wenn Liris offen — wartet nicht auf den naechsten
    // Poll-Tick (3s). Mehrere Retries weil Liris asynchron re-rendert.
    if (!isOpen) return
    const wv = webviewRef.current as any
    if (!wv?.executeJavaScript) return
    const ids = [150, 700, 2000].map(ms =>
      window.setTimeout(() => highlightRef.current?.(), ms)
    )
    return () => ids.forEach(id => window.clearTimeout(id))
  }, [staleRecallPids, knownRecallPids, staleReferenceDate, isOpen])

  // Aggregiere Zähler über mehrere vergangene Tage hinweg. Wenn sich
  // staleReferenceDate ändert und der Tag in der Vergangenheit liegt,
  // speichere die aktuellen Zähler für diesen Tag in dayHistory.
  // Wenn beide Zähler 0 sind, entferne den Tag (= alle bearbeitet).
  // Mit 1s Debounce um Flackern zu vermeiden.
  const todayIso = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const zeroCountTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!staleReferenceDate || !isOpen) return
    // In der Patienten-Akte gibt es keine Tagesliste → der Scan meldet 0 und
    // würde den Tag sonst löschen. Banner soll weiter angezeigt werden, also
    // dayHistory hier unverändert lassen.
    if (markIsAkte) return
    if (staleReferenceDate >= todayIso) return  // Nur vergangene Tage

    if (markStaleCount === 0 && markMissingCount === 0) {
      // Beide Zähler 0 → mit Debounce warten, ob sie wieder nicht-0 werden
      if (zeroCountTimeoutRef.current) clearTimeout(zeroCountTimeoutRef.current)
      zeroCountTimeoutRef.current = setTimeout(() => {
        setDayHistory(prev => {
          const newHistory = { ...prev }
          delete newHistory[staleReferenceDate]
          return newHistory
        })
      }, 3000)  // 3s Debounce — gründliche Überprüfung vor Anzeige
    } else {
      // Speichere die markierten PIDs für diesen Tag. Die Anzeige-Zahl wird
      // später live gegen die aktuellen offenen Recall-PIDs berechnet.
      if (zeroCountTimeoutRef.current) clearTimeout(zeroCountTimeoutRef.current)
      setDayHistory(prev => {
        const newHistory = { ...prev }
        newHistory[staleReferenceDate] = { stalePids: markStalePids, missingPids: markMissingPids }
        return newHistory
      })
    }
  }, [staleReferenceDate, markStaleCount, markMissingCount, markStalePids, markMissingPids, todayIso, isOpen, markIsAkte])

  // Cleanup debounce Timer
  useEffect(() => {
    return () => {
      if (zeroCountTimeoutRef.current) clearTimeout(zeroCountTimeoutRef.current)
    }
  }, [])

  // PID-Injection: feuert jedes Mal wenn pendingPid sich ändert.
  // Funktioniert auch wenn das Panel schon offen ist (dom-ready feuert dann nicht mehr).
  useEffect(() => {
    console.log('[Liris] inject-useEffect fired, pendingPid=', pendingPid, 'isOpen=', isOpen)
    if (!pendingPid || !isOpen) {
      console.log('[Liris] early return — no pendingPid or panel closed')
      return
    }

    const pid = pendingPid
    // ALLE setTimeouts in diesem Effect tracken, damit Cleanup sauber alles
    // abraeumt (Inject-Delay, etc.).
    const timers: number[] = []
    const setT = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms)
      timers.push(id)
      return id
    }
    // Fokus-Management entfernt — verursachte Race-Conditions die manuelle
    // Tastatureingaben im "Patient bearbeiten"-Modal blockieren konnten.
    // User muss ggf. selbst zurueck ins Input klicken nach Liris-Injection.

    const doInject = () => {
      const wv = webviewRef.current as any
      if (!wv?.executeJavaScript) return
      const script = `
        (function() {
          var pidStr0 = ${JSON.stringify(pid)};
          function vis0(n){ if(!n||n.offsetParent===null) return false; var r=n.getBoundingClientRect(); return r.width>0&&r.height>0; }
          // 0) Ist der Termin des Patienten im aktuellen Kalender sichtbar?
          //    Dann Einfachklick auf das FullCalendar-Event (a.fc-event) →
          //    Liris öffnet "Termin bearbeiten" (statt Suche → Akte).
          var marked = document.querySelector('[data-az-recall-pid="'+pidStr0+'"]');
          if (marked) {
            var fcEv = marked.classList && marked.classList.contains('fc-event') ? marked
              : (marked.closest ? marked.closest('.fc-event') : null);
            if (fcEv && vis0(fcEv)) {
              fcEv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              fcEv.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
              fcEv.click();
              return 'termin-clicked';
            }
          }
          var sel = 'input[placeholder^="Allgemeine Suche"]';
          var el = document.querySelector(sel);
          if (!el) return 'no-input-found';
          var proto = Object.getPrototypeOf(el);
          var desc = Object.getOwnPropertyDescriptor(proto, 'value');
          var setter = desc && desc.set;
          // Cache-Bust: Feld ERST leeren (mit input-Event), dann neu tippen.
          // Bleibt der Wert gleich, fragt das Liris-Autocomplete den Server
          // nicht neu ab und zeigt veraltete Termine (z.B. nach Termin-
          // Anlage/-Loeschung). Leeren+Neutippen erzwingt eine frische Abfrage
          // — ohne das ganze Liris neu zu laden.
          if (setter) setter.call(el, ''); else el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function() {
            if (setter) setter.call(el, ${JSON.stringify(pid)});
            else el.value = ${JSON.stringify(pid)};
            el.dispatchEvent(new Event('input',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, 150);
          // KEIN el.focus() — würde den Tastatur-Fokus ins Liris-Webview ziehen und
          // Eingaben in App-Feldern (Suche/Bearbeiten) blockieren. Das Autocomplete
          // reagiert auf das input-Event auch ohne Fokus; die Treffer-Auswahl unten
          // findet den Eintrag per PID-Text.

          // Termin-Vorschau aus dem Such-Dropdown lesen: Liris zeigt dort unter
          // "Termin" den naechsten Termin im klaren Format "Fr. 07 August 2026,
          // 10:30 (Arzt)" — VERSCHWINDET sobald der Patient ausgewaehlt wird.
          // Muss daher HIER (waehrend das Dropdown offen ist) gelesen werden,
          // nicht erst auf der Akte-Seite danach.
          function readTerminPreview() {
            var monthsDe = { Januar:1, Februar:2, 'M\\u00e4rz':3, April:4, Mai:5, Juni:6,
                             Juli:7, August:8, September:9, Oktober:10, November:11, Dezember:12 };
            var re = /(?:Mo|Di|Mi|Do|Fr|Sa|So)\\.?\\s+(\\d{1,2})\\.?\\s+(Januar|Februar|M\\u00e4rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\\s+(\\d{4})\\s*,?\\s+(\\d{2}):(\\d{2})/;
            var txt = document.body ? document.body.innerText : '';
            var m = txt.match(re);
            if (!m) return null;
            var monIdx = monthsDe[m[2]];
            if (!monIdx) return null;
            var today = new Date(); today.setHours(0,0,0,0);
            var d = new Date(+m[3], monIdx - 1, +m[1]);
            if (d.getTime() < today.getTime()) return null; // nur zukuenftige Termine
            var dayNum = +m[1];
            var dd = (dayNum < 10 ? '0' : '') + dayNum;
            var mo = (monIdx < 10 ? '0' : '') + monIdx;
            return { datum: m[3] + '-' + mo + '-' + dd, zeit: m[4] + ':' + m[5] };
          }
          var terminPreview = readTerminPreview();

          // Autocomplete-Dropdown abwarten und ersten Treffer auswaehlen.
          // Liris laedt die Vorschlaege per AJAX -> kurz warten.
          var pidStr = ${JSON.stringify(pid)};
          function isVisible(node) {
            if (!node || node.offsetParent === null) return false;
            var r = node.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          }
          function selectFirst() {
            // 1) PID-spezifisch: suche ein klickbares Element, dessen Text die
            //    PID enthaelt (z.B. "Sestito Heidi #961"). Das ist robust
            //    gegen unbekannte Klassen-Namen / Framework-Wechsel.
            var clickables = document.querySelectorAll('a, button, li, [role="option"], [role="button"], div[onclick], tr[onclick]');
            for (var k = 0; k < clickables.length; k++) {
              var c = clickables[k];
              if (!isVisible(c)) continue;
              // gleichen Knoten nicht doppelt zaehlen — Eltern haben Text der Kinder
              var ownText = c.textContent || '';
              if (ownText.indexOf(pidStr) === -1) continue;
              // Suchfeld selbst nicht klicken
              if (c.tagName === 'INPUT' || c.contains(el)) continue;
              c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              c.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
              c.click();
              return 'clicked-by-pid';
            }

            // 2) Klasse-basiert: sichtbares Dropdown-Item finden und klicken.
            var itemSelectors = [
              '.ui-autocomplete li:first-child a',
              '.ui-autocomplete li:first-child',
              '.autocomplete-suggestion',
              '.dropdown-menu li:first-child a',
              '.dropdown-menu li:first-child',
              '[role="option"]',
              '.tt-suggestion',
              'ul.typeahead li:first-child'
            ];
            for (var i = 0; i < itemSelectors.length; i++) {
              var item = document.querySelector(itemSelectors[i]);
              if (item && isVisible(item)) {
                item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                item.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
                item.click();
                return 'clicked-by-class';
              }
            }
            // 3) Fallback: Pfeil-runter + Enter im Suchfeld (Keyboard-Navigation).
            ['keydown','keyup'].forEach(function(t) {
              el.dispatchEvent(new KeyboardEvent(t, {
                key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true
              }));
            });
            ['keydown','keypress','keyup'].forEach(function(t) {
              el.dispatchEvent(new KeyboardEvent(t, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
              }));
            });
            return 'keyboard';
          }

          // Prueft ob ueberhaupt Dropdown-Treffer sichtbar sind.
          function hasDropdownItems() {
            var sels = ['.ui-autocomplete li', '.autocomplete-suggestion',
              '.dropdown-menu li', '[role="option"]', '.tt-suggestion', 'ul.typeahead li'];
            for (var i = 0; i < sels.length; i++) {
              var items = document.querySelectorAll(sels[i]);
              for (var j = 0; j < items.length; j++) {
                if (isVisible(items[j]) && (items[j].textContent || '').trim()) return true;
              }
            }
            // Auch: ein klickbares Element das die PID enthaelt
            var clickables = document.querySelectorAll('a, li, [role="option"], tr[onclick]');
            for (var m = 0; m < clickables.length; m++) {
              if (isVisible(clickables[m]) && (clickables[m].textContent || '').indexOf(pidStr) !== -1) return true;
            }
            return false;
          }

          // Mehrere Versuche, falls das Dropdown langsam laedt.
          // Promise resolved mit 'selected' (Treffer geklickt),
          // 'navigated' (Seite hat sich geaendert) oder 'no-result' (leeres Dropdown).
          return new Promise(function(resolve) {
            var tries = 0;
            var sawItems = false;
            var iv = setInterval(function() {
              tries++;
              if (!terminPreview) terminPreview = readTerminPreview();
              if (hasDropdownItems()) sawItems = true;
              var res = selectFirst();
              if (res && res.indexOf('clicked') === 0) { clearInterval(iv); resolve({ status: 'selected', terminPreview: terminPreview }); return; }
              if (tries >= 6) {
                clearInterval(iv);
                // Wenn nie ein Dropdown-Item erschien -> Patient nicht gefunden.
                resolve({ status: sawItems ? 'selected' : 'no-result', terminPreview: terminPreview });
              }
            }, 350);
          });
        })();
      `
      wv.executeJavaScript(script)
        .then((res: any) => {
          console.log('[Liris] inject script done, result=', res)
          clearPendingPid()
          // WICHTIG: Nach der Injektion hat das Liris-<webview> den Tastatur-
          // Fokus (el.focus() für die Suche). Den Fokus aktiv ans App-Fenster
          // zurückgeben, sonst sind Eingaben im «Patient bearbeiten»-Modal
          // blockiert. Mehrfach blurren, da Liris den Fokus verzögert greift.
          const releaseFocus = () => { try { (webviewRef.current as any)?.blur?.() } catch { /* ignore */ } }
          releaseFocus(); [120, 400, 900].forEach(ms => window.setTimeout(releaseFocus, ms))
          // Termin-Event angeklickt → "Termin bearbeiten" ist offen, keine Akte.
          // Kein Auto-Auslesen (die Termin-Ansicht enthält die Akten-Daten nicht).
          if (res === 'termin-clicked') {
            console.log('[Liris] Termin bearbeiten geöffnet (Einfachklick auf Kalender-Event)')
            return
          }
          // Neues Ergebnis-Format: { status, terminPreview } statt reinem String.
          const status = typeof res === 'string' ? res : res?.status
          const terminPreview: { datum: string; zeit: string } | null =
            (res && typeof res === 'object' && res.terminPreview) ? res.terminPreview : null
          if (terminPreview) console.log('[Liris] Termin aus Such-Dropdown gelesen:', terminPreview)
          // Kein Suchfeld oder kein Dropdown-Treffer: Retry nach kurzer
          // Wartezeit statt sofort notFound — Liris braucht manchmal
          // laenger bis das Suchfeld sichtbar ist.
          if (status === 'no-result' || status === 'no-input-found') {
            console.log('[Liris] inject got', status, '— will retry extract')
          }
          // Extract-Timer NICHT ueber setT (=in timers-Array) anlegen —
          // clearPendingPid loest gleich einen useEffect-Re-Run aus, dessen
          // Cleanup alle Timer abraeumt. Wir wollen aber dass dieser Timer
          // fest steht. Daher window.setTimeout direkt + KEIN tracking.
          // Mehrere Versuche mit steigender Wartezeit — Liris braucht
          // manchmal lange bis die Detailseite fertig gerendert ist.
          // Mehrere Versuche mit steigender Wartezeit. WICHTIG: Solange die
          // Postadresse (Kontaktangaben-Block) noch fehlt, wird WEITER nachgeladen
          // — der Block erscheint in Liris oft verzoegert. Name/Geb. etc. werden
          // bei jedem Versuch sofort uebernommen, die Adresse sobald sie da ist.
          const ADDR_MAX = 7
          const delays = [1200, 2500, 4000, 6000, 8000, 10000, 10000]
          const tryExtract = (attempt: number) => {
            const delay = delays[Math.min(attempt, delays.length - 1)]
            window.setTimeout(() => {
              console.log('[Liris] starting extract for pid=', pid, 'attempt', attempt + 1)
              extractLirisInfo(wv, pid).then(info => {
                if (info) {
                  // PID wurde ueber Dropdown ausgewaehlt — Patient existiert.
                  // Termin-Vorschau aus dem Such-Dropdown ist zuverlaessiger als
                  // alles was sich aus der Akte-Seite selbst herausparsen laesst
                  // — hat daher Vorrang, falls vorhanden.
                  const merged = terminPreview
                    ? { ...info, naechsterTerminDatum: terminPreview.datum, naechsterTerminZeit: terminPreview.zeit }
                    : info
                  setLirisExtract({ ...merged, pidMatchesLiris: true, notFound: false, at: Date.now() })
                  // Suchdropdown schliessen falls noch offen (z.B. wenn Akte bereits geladen war).
                  try {
                    wv.executeJavaScript(`(function(){
                      var inp = document.querySelector('input[placeholder^="Allgemeine Suche"]');
                      if (inp) {
                        ['keydown','keyup'].forEach(function(t){
                          inp.dispatchEvent(new KeyboardEvent(t,{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));
                        });
                      }
                    })()`)
                  } catch { /* ignore */ }
                }
                const needMore = (!info || !info.postAdresse) && attempt < ADDR_MAX - 1
                if (needMore) {
                  console.log('[Liris] extract ohne Adresse — erneut versuchen…')
                  tryExtract(attempt + 1)
                }
              }).catch((err: unknown) => console.warn('[Liris] extract threw:', err))
            }, delay)
          }
          tryExtract(0)
        })
        .catch((err: unknown) => {
          console.warn('[Liris] inject script error:', err)
          clearPendingPid()
        })
    }

    let detachReady: (() => void) | null = null

    if (webviewReady.current) {
      // Webview bereits geladen — sofort injizieren
      setT(doInject, 300)
    } else {
      // Webview lädt noch oder wurde noch nicht gemountet —
      // dom-ready abwarten. Guard NACH dem dom-ready-Event, nicht vorher.
      const onReady = () => {
        webviewReady.current = true
        setT(doInject, 800)
      }
      const attach = () => {
        const wv = webviewRef.current as any
        if (!wv) return false
        wv.addEventListener('dom-ready', onReady)
        detachReady = () => wv.removeEventListener('dom-ready', onReady)
        return true
      }
      // Webview-Element könnte noch nicht im DOM sein wenn isOpen soeben true wurde.
      if (!attach()) setT(() => { attach() }, 50)
    }

    return () => {
      timers.forEach(clearTimeout)
      detachReady?.()
    }
  }, [pendingPid, isOpen, clearPendingPid])

  // Resize panel by dragging the grip
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startW: width }
    setResizing(true)  // Overlay über das Webview legen, damit es die Maus-Events nicht schluckt
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = resizeRef.current.startX - ev.clientX
      const newW = Math.max(300, Math.min(1200, resizeRef.current.startW + delta))
      // Per requestAnimationFrame aktualisieren → flüssig, max. 1 Update pro Frame.
      if (resizeRafRef.current) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = requestAnimationFrame(() => setWidth(newW))
    }
    const onUp = () => {
      if (resizeRafRef.current) { cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = null }
      if (resizeRef.current) {
        // Endbreite persistieren, damit sie nach Neustart erhalten bleibt
        setWidth(w => { localStorage.setItem('liris-panel-width', String(w)); return w })
      }
      resizeRef.current = null
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }


  // Klick auf ein Datum in der Meldung -> im Liris-Mini-Kalender zum
  // entsprechenden Monat blaettern und den Tag anklicken, sodass der
  // Haupt-Kalender direkt zu diesem Tag springt. Nur im Electron-Webview
  // moeglich (executeJavaScript). Defensiv: erkennt Monat/Jahr ueber
  // mehrere Muster, blaettert host-gesteuert (async) und klickt dann den Tag.
  const navigateLirisToDay = async (iso: string) => {
    const wv = webviewRef.current as any
    if (!wv?.executeJavaScript) return
    const mIso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    if (!mIso) return
    const year = parseInt(mIso[1], 10)
    const month = parseInt(mIso[2], 10)
    const day = parseInt(mIso[3], 10)
    const sleep = (ms: number) => new Promise<void>(res => window.setTimeout(res, ms))

    // Schritt 0: Befindet man sich in der Patienten-Akte, ist KEIN Mini-Kalender
    // sichtbar. Dann zuerst ueber den "Terminkalender"-Link (oben links in Liris)
    // zur Kalenderansicht wechseln und auf den Mini-Kalender warten.
    const hasMiniCal = () => wv.executeJavaScript(`!!document.getElementById('cal-event-mini-calendar')`).catch(() => false)
    if (!(await hasMiniCal())) {
      await wv.executeJavaScript(`(function(){
        var as = [].slice.call(document.querySelectorAll('a'));
        for (var k=0;k<as.length;k++){
          if ((as[k].innerText || as[k].textContent || '').trim() === 'Terminkalender') { as[k].click(); return true; }
        }
        return false;
      })()`).catch(() => false)
      // Auf den Mini-Kalender warten (max. ~3s)
      for (let i = 0; i < 15; i++) {
        await sleep(200)
        if (await hasMiniCal()) break
      }
    }

    // Liest Monat+Jahr aus dem Mini-Kalender-Header. Erkennt volle deutsche
    // Monatsnamen, 3-Buchstaben-Abkuerzungen und numerische MM.YYYY / MM/YYYY.
    const readMonth = `(function(){
      var mc = document.getElementById('cal-event-mini-calendar');
      if (!mc) return null;
      var t = (mc.textContent || '').toLowerCase();
      var full = ['januar','februar','märz','april','mai','juni','juli','august','september','oktober','november','dezember'];
      var ab   = ['jan','feb','mär','apr','mai','jun','jul','aug','sep','okt','nov','dez'];
      // 1) Voller Monatsname + Jahr
      var m1 = t.match(/(januar|februar|m\\u00e4rz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\\s*((?:19|20)\\d{2})/);
      if (m1) { var k = m1[1]==='maerz'?'m\\u00e4rz':m1[1]; return { month: full.indexOf(k)+1, year: parseInt(m1[2],10) }; }
      // 2) Abkuerzung + Jahr
      var m2 = t.match(/(jan|feb|m\\u00e4r|mar|apr|mai|jun|jul|aug|sep|okt|nov|dez)\\w*\\.?\\s*((?:19|20)\\d{2})/);
      if (m2) { var a = m2[1]==='mar'?'m\\u00e4r':m2[1]; var i2 = ab.indexOf(a); if (i2>=0) return { month: i2+1, year: parseInt(m2[2],10) }; }
      // 3) Numerisch MM.YYYY / MM/YYYY / MM-YYYY
      var m3 = t.match(/(?:^|[^\\d])(0?[1-9]|1[0-2])[.\\/-]((?:19|20)\\d{2})/);
      if (m3) return { month: parseInt(m3[1],10), year: parseInt(m3[2],10) };
      return null;
    })()`

    // Klickt den Vor-/Zurueck-Pfeil im Mini-Kalender (dir<0 = zurueck).
    const clickArrow = (dir: number) => wv.executeJavaScript(`(function(){
      var mc = document.getElementById('cal-event-mini-calendar');
      if (!mc) return 'no-mc';
      var prevSym = ['‹','«','<','◄','◀','❮'];
      var nextSym = ['›','»','>','►','▶','❯'];
      var els = mc.querySelectorAll('a,button,span,div,i,th,td');
      for (var i=0;i<els.length;i++){
        var el = els[i];
        var tx = (el.textContent||'').trim();
        var meta = ((el.className||'')+' '+(el.title||'')+' '+(el.getAttribute('aria-label')||'')).toLowerCase();
        var isPrev = prevSym.indexOf(tx)>=0 || /prev|back|previous|zurück|vorher/.test(meta);
        var isNext = nextSym.indexOf(tx)>=0 || /next|forward|weiter|näch|vorw/.test(meta);
        if (${dir} < 0 && isPrev) { el.click(); return 'prev'; }
        if (${dir} > 0 && isNext) { el.click(); return 'next'; }
      }
      return 'no-arrow';
    })()`).catch(() => 'err')

    // Schritt 1: zum Zielmonat/-jahr blaettern (max. 36 Schritte = 3 Jahre).
    let guard = 0
    while (guard++ < 36) {
      const cur = await wv.executeJavaScript(readMonth).catch(() => null)
      if (!cur) break  // Mini-Kalender nicht sichtbar (z.B. Patient-Detail offen)
      const curIdx = cur.year * 12 + (cur.month - 1)
      const tgtIdx = year * 12 + (month - 1)
      if (curIdx === tgtIdx) break
      const r = await clickArrow(tgtIdx > curIdx ? 1 : -1)
      if (r === 'no-arrow' || r === 'no-mc') break
      await sleep(220)
    }

    // Schritt 2: den Tag im Mini-Kalender anklicken. ACHTUNG: In der Monats-
    // ansicht erscheinen auch Nachbarmonats-Tage gleicher Zahl (z.B. 30. April
    // in der Mai-Ansicht). Daher Kandidaten sammeln und den AKTUELLEN-Monat-Tag
    // wählen: nicht-adjazent (Klasse/Transparenz) bevorzugen, dann Positions-
    // Heuristik (grosse Tage stehen in der aktuellen Ansicht weiter unten).
    await wv.executeJavaScript(`(function(){
      var mc = document.getElementById('cal-event-mini-calendar');
      if (!mc) return 'no-mc';
      var dayNum = ${day};
      var cells = mc.querySelectorAll('td,a,div,span,button');
      var cands = [];
      for (var i=0;i<cells.length;i++){
        var el = cells[i];
        if ((el.textContent||'').trim() !== String(dayNum)) continue;
        if (el.children && el.children.length > 2) continue;
        var cls = ((el.className||'')+' '+((el.parentElement&&el.parentElement.className)||'')).toLowerCase();
        var adj = /other|muted|disabled|adjacent|outside|sibling|prev|next|grey|gray|faded|inactive|dim/.test(cls) ? 1 : 0;
        var op = 1; try { op = parseFloat(getComputedStyle(el).opacity||'1'); } catch(e){}
        cands.push({ el: el, adj: adj, op: isNaN(op)?1:op, idx: i });
      }
      if (!cands.length) return 'no-day';
      cands.sort(function(a,b){
        if (a.adj !== b.adj) return a.adj - b.adj;            // nicht-adjazent zuerst
        if (Math.abs(a.op-b.op) > 0.05) return b.op - a.op;   // deckender zuerst
        return dayNum > 15 ? b.idx - a.idx : a.idx - b.idx;   // Positions-Heuristik
      });
      cands[0].el.click();
      return 'day-clicked';
    })()`).catch(() => {})
  }

  if (!isOpen) return null

  // Aggregierte Meldung: zeige max. 2 Tage mit unverarbeiteten Patienten
  // (neueste zuerst). Die Zahl wird LIVE berechnet: von den damals pro Tag
  // markierten PIDs zaehlen nur die, die JETZT noch offen sind (stale = noch
  // in staleRecallPids; missing = weiterhin nicht im Recall). So sinkt die
  // Zahl automatisch sobald ein Patient bearbeitet wurde — auch ohne den Tag
  // erneut zu oeffnen — und ein hängengebliebener Zaehler verschwindet.
  const liveStaleSet = new Set(staleRecallPids)
  const liveKnownSet = new Set(knownRecallPids)
  // Nur Tage im ±14-Tage-Fenster um den aktuell geprüften Tag berücksichtigen.
  const refMs = staleReferenceDate ? Date.parse(staleReferenceDate + 'T00:00:00Z') : null
  const WINDOW_MS = 14 * 24 * 3600 * 1000
  const dayEntries = Object.entries(dayHistory)
    .map(([date, rec]) => {
      const stalePids = rec.stalePids.filter(p => liveStaleSet.has(p))
      const missingPids = rec.missingPids.filter(p => !liveKnownSet.has(p))
      return [date, { stale: stalePids.length, missing: missingPids.length, stalePids, missingPids }] as const
    })
    .filter(([, counts]) => counts.stale > 0 || counts.missing > 0)
    .filter(([date]) => {
      if (refMs === null) return true
      const d = Date.parse(date + 'T00:00:00Z')
      return Number.isNaN(d) ? true : Math.abs(d - refMs) <= WINDOW_MS
    })
    .sort(([a], [b]) => b.localeCompare(a))  // Neueste zuerst
    .slice(0, 2)  // Nur die letzten 2 Tage gleichzeitig — weitere rücken nach
  const hasAnyPastData = dayEntries.length > 0
  // Fuer den eingeklappten Streifen: zeigt farbig an, dass dahinter noch
  // offene Punkte warten (nicht aktualisiert / nicht im Recall erfasst),
  // damit das beim Zuklappen nicht vergessen geht.
  const collapsedTotalStale   = dayEntries.reduce((sum, [, c]) => sum + c.stale, 0)
  const collapsedTotalMissing = dayEntries.reduce((sum, [, c]) => sum + c.missing, 0)
  const collapsedHasAlerts = collapsedTotalStale > 0 || collapsedTotalMissing > 0

  return (
    <div
      className="flex flex-row flex-shrink-0 border-l border-gray-200 bg-white relative z-50 overflow-hidden"
      style={{ width: collapsed ? 40 : width }}
    >

      {/* Eingeklappt: schmaler Streifen zum schnellen Aufklappen.
          Das Webview bleibt darunter gemountet → Liris lädt NICHT neu. */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          title={collapsedHasAlerts
            ? `Liris aufklappen · Strg+L — ${collapsedTotalStale + collapsedTotalMissing} offene Punkte (nicht aktualisiert / nicht im Recall)`
            : 'Liris aufklappen · Strg+L'}
          className={`absolute inset-0 z-30 w-10 border-l flex flex-col items-center justify-center gap-2 transition-colors ${
            collapsedHasAlerts
              ? 'bg-orange-100 hover:bg-orange-200 border-orange-300 text-orange-700'
              : 'bg-gray-50 hover:bg-primary-50 border-gray-200 text-gray-500 hover:text-primary-600'
          }`}
        >
          {collapsedHasAlerts && (
            <span className="absolute top-1.5 w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center justify-center">
              {collapsedTotalStale + collapsedTotalMissing}
            </span>
          )}
          <ArrowLeft className="w-4 h-4" />
          <span className="text-[10px] font-semibold tracking-wider [writing-mode:vertical-rl] rotate-180">Liris</span>
        </button>
      )}

      {/* Resize grip (nur ausgeklappt) */}
      {!collapsed && (
        <div
          className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize z-10 hover:bg-primary-50 group"
          onMouseDown={onResizeMouseDown}
        >
          <GripVertical className="w-3 h-3 text-gray-300 group-hover:text-primary-400" />
        </div>
      )}

      {/* Während des Resize: transparentes Overlay über das ganze Fenster,
          damit das <webview> die Maus-Events nicht schluckt → flüssiges Ziehen. */}
      {resizing && <div className="fixed inset-0 z-[100] cursor-col-resize select-none" />}

      {/* Panel content */}
      <div className="flex flex-col flex-1 pl-3 min-w-0">

        {/* Toolbar row: Recall-seit + Edit + Close */}
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-gray-50 shrink-0">
          <button
            onClick={() => (webviewRef.current as any)?.goBack()}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            title="Zurück"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-gray-600" />
          </button>
          <button
            onClick={() => (webviewRef.current as any)?.goForward()}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            title="Vorwärts"
          >
            <ArrowRight className="w-3.5 h-3.5 text-gray-600" />
          </button>
          <button
            onClick={() => (webviewRef.current as any)?.reload()}
            className="p-1 rounded hover:bg-gray-200 transition-colors"
            title="Neu laden"
          >
            <RotateCcw className={`w-3.5 h-3.5 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Kompakte URL-Leiste */}
          <input
            type="text"
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { navigate(inputUrl); (e.currentTarget as HTMLInputElement).blur() } }}
            onFocus={e => e.currentTarget.select()}
            spellCheck={false}
            title={inputUrl}
            placeholder="URL…"
            className="min-w-0 flex-1 max-w-[260px] px-2 py-0.5 text-[10px] text-gray-600 bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-300 truncate"
          />

          <div className="flex-1" />

          {/* Meldung: Aggregierte Zähler von mehreren vergangenen Tagen.
              Zeigt alle Tage, die der Nutzer angesehen hat, mit ihren jeweiligen offenen Patienten. */}
          {hasAnyPastData && (
            <div className="flex items-center gap-1.5 bg-orange-100 border border-orange-300 rounded-lg px-2 py-0.5"
                 title="Offene Patienten von vergangenen Tagen — noch nicht im Recall aktualisiert.">
              <span className="text-orange-600">⚠</span>
              <span className="text-[11px] font-semibold text-orange-800 select-none">
                {dayEntries.map(([date, counts], idx) => {
                  const dateStr = date.split('-').reverse().join('.')
                  const parts: string[] = []
                  if (counts.stale > 0) parts.push(`${counts.stale} vom ${dateStr}`)
                  if (counts.missing > 0) parts.push(`${counts.missing} neu${counts.stale > 0 ? '' : ` vom ${dateStr}`}`)
                  // Konkrete PIDs in den Tooltip — damit man sieht, WELCHE Patienten
                  // gemeint sind (auch wenn man gerade nicht auf dem Tag ist).
                  const pidInfo = [
                    counts.stalePids.length ? `zu aktualisieren: ${counts.stalePids.map(p => '#' + p).join(', ')}` : '',
                    counts.missingPids.length ? `neu (nicht im Recall): ${counts.missingPids.map(p => '#' + p).join(', ')}` : '',
                  ].filter(Boolean).join('\n')
                  return (
                    <span key={date}>
                      {idx > 0 && ' · '}
                      <button
                        type="button"
                        onClick={() => navigateLirisToDay(date)}
                        className="underline decoration-dotted underline-offset-2 hover:text-orange-900 hover:decoration-solid cursor-pointer"
                        title={`In Liris zum ${dateStr} springen.\n${pidInfo}`}
                      >
                        {parts.join(' + ')}
                      </button>
                    </span>
                  )
                })}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5"
               title="Datum stammt aus dem Liris-Kalender-Header. PIDs werden hervorgehoben deren Recall seit diesem Datum noch nicht aktualisiert wurde.">
            <span className="text-[10px] font-semibold text-amber-700 select-none">Recall seit</span>
            <span className="text-[11px] font-medium text-amber-900 select-none">
              {staleReferenceDate ? staleReferenceDate.split('-').reverse().join('.') : '—'}
            </span>
          </div>

          {/* Recall-Bearbeiten-Button: extrahiert die PID des gerade in
              Liris geoeffneten Patienten (Detail- oder Kalender-Header)
              und oeffnet das Recall-Edit-Popup. */}
          <button
            onClick={async () => {
              const wv = webviewRef.current as any
              if (!wv?.executeJavaScript) return
              try {
                // 1) Versuche Patient-Detail-Header
                const detailPid: string | null = await wv.executeJavaScript(`
                  (function() {
                    var txt = document.body ? (document.body.innerText || '') : '';
                    var anchors = txt.match(/\\(\\s*\\d+\\s*Jahre?\\s*\\)/g);
                    if (!anchors || anchors.length !== 1) return null;
                    var m = txt.match(/\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\(\\s*\\d+\\s*Jahre?\\s*\\)[^\\n#]{0,150}#\\s*0*(\\d{1,7})(?!\\d)/);
                    return m ? m[1] : null;
                  })();
                `).catch(() => null)
                if (detailPid) { requestRecallByPid(detailPid); return }
                // 2) Fallback: erstes #PID DD.MM.YYYY in der Seite
                const anyPid: string | null = await wv.executeJavaScript(`
                  (function() {
                    var txt = document.body ? (document.body.innerText || '') : '';
                    var m = txt.match(/#\\s*0*(\\d{1,7})(?!\\d)(?=\\s+\\d{2}\\.\\d{2}\\.\\d{4})/);
                    return m ? m[1] : null;
                  })();
                `).catch(() => null)
                if (anyPid) requestRecallByPid(anyPid)
              } catch { /* ignore */ }
            }}
            className="p-1.5 rounded hover:bg-primary-50 hover:text-primary-600 transition-colors ml-1"
            title="Recall-Eintrag des aktuell in Liris geoeffneten Patienten bearbeiten"
          >
            <FileEdit className="w-3.5 h-3.5 text-gray-500" />
          </button>

          {/* DEBUG: Liris-Import-Dialog analysieren — nur fuer Admins sichtbar.
              Gibt die DOM-Struktur in die Console aus, damit die Vollautomatik
              bei Liris-Layout-Aenderungen nachgezogen werden kann. */}
          {isAdmin && (
          <button
            onClick={async () => {
              const wv = webviewRef.current as any
              if (!wv?.executeJavaScript) return
              try {
                const struct = await wv.executeJavaScript(`
                  (function() {
                    function vis(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
                    function attrs(el){
                      var a={};
                      for(var i=0;i<el.attributes.length;i++){
                        var n=el.attributes[i].name, v=el.attributes[i].value;
                        if(n==='class'||n==='style')continue;
                        a[n]=(v||'').slice(0,60);
                      }
                      return a;
                    }
                    function desc(el){
                      return {
                        tag: el.tagName.toLowerCase(),
                        text: (el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,60),
                        cls: (el.className||'').toString().slice(0,90),
                        attrs: attrs(el),
                      };
                    }
                    // SVG-Interna ausblenden — nur Rauschen.
                    var SKIP=/^(svg|path|g|rect|circle|polygon|polyline|line|defs|use|ellipse|mask|clippath)$/;
                    var out = { inputs: [], icons: [], clickableText: [], keyword: [] };
                    // alle inputs/textarea/select (inkl. file/hidden)
                    document.querySelectorAll('input,textarea,select').forEach(function(i){
                      var o = { type:i.type||i.tagName.toLowerCase(), id:i.id||null, name:i.name||null,
                        value:(i.value||'').slice(0,40), attrs:attrs(i), visible:vis(i) };
                      if(i.tagName.toLowerCase()==='select'){
                        o.options=[].slice.call(i.options).map(function(x){return x.text.trim().slice(0,40)}).slice(0,40);
                      }
                      out.inputs.push(o);
                    });
                    // Action-Icons: svg-icon mit name + data-tooltip (= die Buttons)
                    document.querySelectorAll('svg-icon,[data-tooltip]').forEach(function(el){
                      if(!vis(el))return;
                      var name=el.getAttribute('name'), tip=el.getAttribute('data-tooltip');
                      if(name||tip) out.icons.push({ name:name||null, tooltip:tip||null,
                        cls:(el.className||'').toString().slice(0,60) });
                    });
                    // klickbare Elemente MIT Text (Links, Listen, Buttons)
                    var seen=[];
                    document.querySelectorAll('a,li,button,[role=button],[onclick]').forEach(function(el){
                      if(!vis(el)||SKIP.test(el.tagName.toLowerCase()))return;
                      if(seen.length>=80)return;
                      var t=(el.innerText||'').trim().replace(/\\s+/g,' ');
                      if(!t||t.length>70)return;
                      seen.push(desc(el));
                    });
                    out.clickableText=seen;
                    // Elemente mit Schluesselwoertern
                    var kw=/mail|gesendet|arzt|\\u00e4rzt|versand|post|brief|importieren|hochladen|bericht|dokument/i;
                    var kwSeen=[];
                    document.querySelectorAll('*').forEach(function(el){
                      if(!vis(el)||kwSeen.length>=60||SKIP.test(el.tagName.toLowerCase()))return;
                      if(el.children.length>3)return;
                      var t=(el.innerText||'').trim().replace(/\\s+/g,' ');
                      if(t&&t.length<=60&&kw.test(t)){ kwSeen.push(desc(el)); }
                    });
                    out.keyword=kwSeen;
                    return JSON.stringify(out, null, 2);
                  })();
                `)
                console.log('%c[Liris-Inspektor] Import-Dialog DOM-Struktur:', 'color:#16a34a;font-weight:bold')
                console.log(struct)
                try { await navigator.clipboard.writeText(String(struct)) } catch { /* ignore */ }
                window.alert('Liris-Dialog analysiert — Struktur in Console (F12) + in Zwischenablage kopiert.')
              } catch (e) { window.alert('Analyse fehlgeschlagen: ' + String(e)) }
            }}
            className="p-1.5 rounded hover:bg-emerald-50 hover:text-emerald-600 transition-colors ml-1"
            title="DEBUG: Liris-Import-Dialog analysieren (Struktur in Console)"
          >
            <span className="text-xs font-bold">🔍</span>
          </button>
          )}

          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors ml-1"
            title="Liris einklappen (bleibt geladen) · Strg+L"
          >
            <ArrowRight className="w-3.5 h-3.5 text-gray-500" />
          </button>
          <button
            onClick={close}
            className="p-1.5 rounded hover:bg-red-50 hover:text-red-500 transition-colors"
            title="Browser schliessen"
          >
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>

        {/* Webview — partition ist pro User, damit Liris-Logins nicht geteilt werden */}
        {/* @ts-ignore */}
        <div className="relative flex-1 min-w-0 flex">
          {/* @ts-ignore */}
          <webview
            ref={webviewRef as any}
            src={currentUrl}
            partition={partition}
            className="flex-1 w-full"
            allowpopups="true"
            disablewebsecurity="false"
            // visibility:hidden statt display:none → Webview bleibt geladen
            // (kein Liris-Reload), malt aber nicht über App-Dialoge.
            style={{ minHeight: 0, visibility: lirisSuppressed ? 'hidden' : 'visible' }}
          />
          {lirisSuppressed && (
            <div className="absolute inset-0 bg-white/95 flex items-center justify-center text-center px-3 text-xs text-gray-400 select-none">
              Liris ausgeblendet, während ein Dialog offen ist
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
