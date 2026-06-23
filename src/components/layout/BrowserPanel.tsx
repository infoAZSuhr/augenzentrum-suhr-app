import { useRef, useState, useEffect, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw, X, GripVertical, FileEdit } from 'lucide-react'
import { useBrowser } from '../../contexts/BrowserContext'
import { useAuth } from '../../lib/AuthContext'

/** Extrahiert Geburtsdatum + Autor aus der aktuell in Liris geoeffneten
 *  Patient-Untersuchung. Heuristisch — versucht mehrere DOM-Patterns weil
 *  wir die genaue Liris-HTML-Struktur nicht kennen. Gibt null zurueck wenn
 *  nichts gefunden.
 *
 *  Wird nach PID-Inject + ~1.5s Render-Delay ausgefuehrt. */
async function extractLirisInfo(wv: any, pid: string): Promise<{ pid: string; pidMatchesLiris: boolean; vorname: string | null; nachname: string | null; gebDatum: string | null; autor: string | null; letzteKons: string | null; intervalWeeks: number | null; notFound: boolean; verstorben: boolean; anrede: string | null; postAdresse: string | null; email: string | null; bpKeywords: string[]; naechsterTerminDatum: string | null; naechsterTerminZeit: string | null; naechsterTerminRaw: string | null; bpText: string | null } | null> {
  if (!wv?.executeJavaScript) return null
  // PID ohne # — Liris zeigt evtl. mit oder ohne Padding (0042 vs 42).
  const expectedPidDigits = (pid || '').replace(/\D/g, '').replace(/^0+/, '')
  const script = `
    (function() {
      var expectedPid = ${JSON.stringify(expectedPidDigits)};
      var result = { pidMatchesLiris: false, vorname: null, nachname: null, gebDatum: null, autor: null, letzteKons: null, intervalWeeks: null, notFound: false, verstorben: false, anrede: null, postAdresse: null, email: null, bpKeywords: [], naechsterTerminDatum: null, naechsterTerminZeit: null, naechsterTerminRaw: null, bpText: null, _debug: { textLen: 0 } };
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
      var nameRe = /(?:Frau|Herr|Fr\\.|Hr\\.)\\s+([A-ZÄÖÜ][\\wäöüÄÖÜß-]+(?:\\s+[A-ZÄÖÜ][\\wäöüÄÖÜß-]+)*?)\\s*,?\\s*\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\(/;
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

      // 5) Autor: "Autor: Dr. Name" / "Autor Prof. ..."
      var autorMatch = allText.match(/Autor:?\\s*([^\\n\\r]{1,80})/);
      if (autorMatch && autorMatch[1]) {
        result.autor = autorMatch[1].trim().replace(/\\s+/g, ' ').slice(0, 80);
        var stop = result.autor.search(/[,\\n\\r]|  /);
        if (stop > 0) result.autor = result.autor.slice(0, stop).trim();
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
          // Format A: "Strasse Nr, PLZ Ort" -> in 2 Zeilen aufsplitten
          var combo = l.match(/^([A-Z\\u00c4\\u00d6\\u00dc][\\w\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc.\\s-]+\\s+\\d+[a-zA-Z]?)\\s*,\\s*(\\d{4,5}\\s+[A-Z\\u00c4\\u00d6\\u00dc][^\\d].*)$/);
          if (combo) { addrLines.push(combo[1].trim(), combo[2].trim()); continue; }
          // Format B: getrennte Zeilen
          if (/^[A-Z\\u00c4\\u00d6\\u00dc][\\w\\u00c4\\u00d6\\u00dc\\u00df\\u00e4\\u00f6\\u00fc.\\s-]+\\s+\\d+[a-zA-Z]?$/.test(l)) { addrLines.push(l); continue; }
          if (/^\\d{4,5}\\s+[A-Z\\u00c4\\u00d6\\u00dc]/.test(l)) { addrLines.push(l); continue; }
        }
        if (addrLines.length) result.postAdresse = addrLines.join('\\n');
        // Email aus dem gesamten Kontaktangaben-Bereich (inkl. Telefonbereich
        // darunter) extrahieren. Wir greifen den 600-Zeichen-Block nach
        // 'Kontaktangaben' und nehmen das erste E-Mail-Muster.
        var emailBlock = allText.slice(kStart, kStart + 600);
        var emailMatch = emailBlock.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/);
        if (emailMatch) result.email = emailMatch[0];
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
      var futA = allText.match(/N(?:ä|ae)chster\\s+Termin\\s*:?\\s*(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s+(\\d{2}):(\\d{2})/i);
      if (futA && isFuture(+futA[3], +futA[2], +futA[1])) {
        result.naechsterTerminDatum = futA[3] + '-' + futA[2] + '-' + futA[1];
        result.naechsterTerminZeit  = futA[4] + ':' + futA[5];
      }
      if (!result.naechsterTerminDatum) {
        // Pattern b: DD.MM.YYYY HH:MM kombiniert im Text
        var re2 = /(\\d{2})\\.(\\d{2})\\.(\\d{4})\\s+(\\d{2}):(\\d{2})/g;
        var bestMs = Infinity, bestM = null, m2;
        while ((m2 = re2.exec(allText)) !== null) {
          if (!isFuture(+m2[3], +m2[2], +m2[1])) continue;
          var ms = new Date(+m2[3], +m2[2]-1, +m2[1], +m2[4], +m2[5]).getTime();
          if (ms < bestMs) { bestMs = ms; bestM = m2; }
        }
        if (bestM) {
          result.naechsterTerminDatum = bestM[3] + '-' + bestM[2] + '-' + bestM[1];
          result.naechsterTerminZeit  = bestM[4] + ':' + bestM[5];
        }
      }

      // Pattern c (Liris-Timeline): blaues Kalender-Icon mit zukuenftigem
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

      // Pattern c2: Liris-Such-Suggestion-Format
      // "Fr. 12 Juni 2026, 07:15 (MPA)" - Wochentag + DD + deutscher
      // Monatsname + YYYY + HH:MM. Scan alle Vorkommen, nimm das
      // naechste zukuenftige.
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
          var ddPad = (+bestSugg.d < 10 ? '0' : '') + bestSugg.d;
          var moPad = (bestSugg.mo < 10 ? '0' : '') + bestSugg.mo;
          result.naechsterTerminDatum = bestSugg.y + '-' + moPad + '-' + ddPad;
          result.naechsterTerminZeit  = bestSugg.h + ':' + bestSugg.min;
        }
      }

      // Pattern d: nur Datum in der Zukunft (ohne Uhrzeit), bevor wir
      // gar nichts liefern. Hilft fuer Termine deren Uhrzeit nur per
      // hover sichtbar waere und kein title gesetzt ist.
      if (!result.naechsterTerminDatum) {
        var re4 = /(\\d{2})\\.(\\d{2})\\.(\\d{4})/g;
        var bestDayMs = Infinity, bestDayM = null, m4;
        while ((m4 = re4.exec(allText)) !== null) {
          if (!isFuture(+m4[3], +m4[2], +m4[1])) continue;
          var ms4 = new Date(+m4[3], +m4[2]-1, +m4[1]).getTime();
          if (ms4 < bestDayMs) { bestDayMs = ms4; bestDayM = m4; }
        }
        if (bestDayM) {
          result.naechsterTerminDatum = bestDayM[3] + '-' + bestDayM[2] + '-' + bestDayM[1];
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
      const res = await wv.executeJavaScript(script)
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
          bpKeywords:    Array.isArray(res.bpKeywords) ? res.bpKeywords : [],
          naechsterTerminDatum: res.naechsterTerminDatum ?? null,
          naechsterTerminZeit:  res.naechsterTerminZeit  ?? null,
          naechsterTerminRaw:   res.naechsterTerminRaw   ?? null,
          bpText:              res.bpText               ?? null,
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
  const { isOpen, close, defaultUrl, pendingPid, clearPendingPid, setLirisExtract, requestRecallByPid, requestRecallNew, staleRecallPids, knownRecallPids, staleReferenceDate, setStaleReferenceDate, reloadLirisAt, setLirisWebContentsId, terminAnlegenRequest, clearTerminAnlegenRequest } = useBrowser()

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
    clearTerminAnlegenRequest()
    const wv = webviewRef.current as any
    if (!wv?.executeJavaScript) return
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    ;(async () => {
      try {
        console.log('[TerminAnlegen] start, pid=', pid, 'grund=', grund)
        // 1) Zum Terminkalender wechseln (Link oben links in Liris)
        const navOk = await wv.executeJavaScript(`(function(){
          var as=[].slice.call(document.querySelectorAll('a'));
          for(var k=0;k<as.length;k++){ if((as[k].innerText||'').trim()==='Terminkalender'){ as[k].click(); return true; } }
          // evtl. sind wir schon im Kalender
          return !!document.querySelector('input[placeholder*="Patientensuche"], input[placeholder*="atientensuche"]');
        })()`)
        console.log('[TerminAnlegen] Terminkalender-Klick/da:', navOk)
        // 2) Auf das Patient-Suchfeld im 'Termin anlegen'-Panel warten
        let fieldDa = false
        for (let i = 0; i < 16 && !fieldDa; i++) {
          await sleep(450)
          fieldDa = await wv.executeJavaScript(`!!document.querySelector('input[placeholder*="atientensuche"]')`).catch(() => false)
        }
        console.log('[TerminAnlegen] Patient-Feld da:', fieldDa)
        if (!fieldDa) return
        await sleep(600)
        // 3) PID ins Patient-Feld tippen (native setter + input-Event)
        await wv.executeJavaScript(`(function(){
          var el=document.querySelector('input[placeholder*="atientensuche"]');
          if(!el) return false;
          el.focus();
          var set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
          set.call(el, ${JSON.stringify('#' + pid)});
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
          return true;
        })()`)
        // 4) Dropdown-Vorschlag mit der PID anklicken. Autocomplete-Listen
        //    reagieren oft auf mousedown/mouseup statt click — daher die
        //    volle Pointer/Maus-Event-Sequenz auf das INNERSTE Treffer-
        //    Element feuern.
        let picked = false
        for (let i = 0; i < 12 && !picked; i++) {
          await sleep(450)
          picked = await wv.executeJavaScript(`(function(){
            var pidRe=new RegExp('#\\\\s*0*' + ${JSON.stringify(pid)} + '(?!\\\\d)');
            var cands=[].slice.call(document.querySelectorAll('li,a,td,div,span,p'));
            var best=null, bestLen=1e9;
            for(var k=0;k<cands.length;k++){
              var el=cands[k];
              var r=el.getBoundingClientRect(); if(r.width<=0||r.height<=0)continue;
              var t=(el.innerText||'').trim();
              if(!t||t.length>140)continue;
              if(!pidRe.test(t))continue;
              // innerstes (kuerzestes) Element bevorzugen, aber Patient-Suchfeld
              // (das Input selbst / dessen Wrapper) ausschliessen.
              if(el.querySelector && el.querySelector('input'))continue;
              if(t.length<bestLen){ best=el; bestLen=t.length; }
            }
            if(!best) return false;
            var r=best.getBoundingClientRect();
            var cx=r.left+r.width/2, cy=r.top+r.height/2;
            var opts={bubbles:true,cancelable:true,view:window,clientX:cx,clientY:cy,button:0};
            ['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown','focus','pointerup','mouseup','click'].forEach(function(type){
              try{
                var Ctor = type.indexOf('pointer')===0 ? (window.PointerEvent||MouseEvent) : (type==='focus'?FocusEvent:MouseEvent);
                best.dispatchEvent(new Ctor(type,opts));
              }catch(e){ try{ best.dispatchEvent(new MouseEvent(type.replace('pointer','mouse'),opts)); }catch(e2){} }
            });
            try{ best.click(); }catch(e){}
            return true;
          })()`).catch(() => false)
        }
        console.log('[TerminAnlegen] Patient ausgewaehlt:', picked)
        await sleep(600)
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
  const [dayHistory, setDayHistory] = useState<Record<string, { stale: number; missing: number }>>({})
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('liris-panel-width'))
    return saved >= 300 && saved <= 1200 ? saved : 480
  })
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
  // — Folge: Tastatureingaben gehen ins Leere. Wir lauschen global auf
  // mousedown (Capture-Phase, damit BEVOR der Click target verarbeitet wird)
  // und blurren das webview wenn der Klick NICHT im webview war.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const wv = webviewRef.current
      if (!wv) return
      if (wv.contains(e.target as Node)) return  // Klick IM webview -> nichts tun
      // Klick ausserhalb -> webview-Focus loslassen (egal ob er noch dran ist
      // oder nicht — schadet nicht, schuetzt aber gegen Geister-Focus).
      try { (wv as any).blur?.() } catch { /* ignore */ }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => document.removeEventListener('mousedown', onMouseDown, true)
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

    // Klick-Listener im Liris-Kalender: erkennt PID des angeklickten Patienten
    // und meldet sie via console.log('__AZ_PID__:<pid>') zurueck an den Host.
    // Sucht die PID im angeklickten Element und bis zu 8 Eltern-Ebenen:
    // zuerst im Text (#1234), dann in Attributen (data-pid, title, href, onclick…).
    const PID_CLICK_INJECT = `
      (function() {
        if (window.__azPidClick) return 'already';
        window.__azPidClick = true;
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
          requestRecallByPid(pid)
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
        // Prio 1: Patienten-Akte offen -> "Untersuchung vom DD.MM.YYYY"
        var m = txt.match(/Untersuchung\\s+vom\\s+(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})/i);
        // Prio 2: Kalender-Tagesheader "Mi. 20/05" / "Mi 20.05.2026"
        if (!m) m = txt.match(/(?:Mo|Di|Mi|Do|Fr|Sa|So)\\.?\\s+(\\d{1,2})[\\/.](\\d{1,2})(?:[\\/.](\\d{2,4}))?/);
        // Prio 3: irgendein DD.MM.YYYY auf der Seite (Fallback)
        if (!m) m = txt.match(/(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})/);
        if (!m) return null;
        var dd = parseInt(m[1], 10);
        var mm = parseInt(m[2], 10);
        var yy = m[3] ? parseInt(m[3], 10) : null;
        if (yy === null) {
          // Liris zeigt links neben dem Wochenheader den 'YYYY#KW'-Marker
          // (z.B. '2025#6' = Woche 6 in 2025) nur dann an, wenn das Jahr
          // vom laufenden abweicht. Wir suchen den Marker im gesamten
          // sichtbaren Text — er kann im DOM vor ODER nach dem Wochentag-
          // Match stehen. Akzeptiert nur plausible Jahre (1990-2099).
          var yrM = txt.match(/(?:^|[^\\d])((?:19|20)\\d{2})\\s*#\\s*\\d{1,2}\\b/);
          yy = yrM ? parseInt(yrM[1], 10) : new Date().getFullYear();
        }
        if (yy < 100) yy += 2000;
        if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
        function p(n){return n<10?'0'+n:''+n;}
        return yy + '-' + p(mm) + '-' + p(dd);
      })();
    `
    const checkCalendarDay = () => {
      wv.executeJavaScript(CALENDAR_DAY_SCRIPT).then((iso: string | null) => {
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
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
      // WebContents-ID des Webviews fuer CDP-Upload bereitstellen
      try { if (wv.getWebContentsId) setLirisWebContentsId(wv.getWebContentsId()) } catch { /* no-op */ }
      wv.executeJavaScript(PID_CLICK_INJECT).catch(() => {})
      scheduleDetailCheck()
      scheduleCalendarDayCheck()
      scheduleRecallHighlight()
    }
    const onConsole = (e: any) => {
      const msg = e?.message || ''
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
          // CSS sicherstellen
          if (!document.getElementById('__az_recall_css')) {
            var st = document.createElement('style');
            st.id = '__az_recall_css';
            st.textContent =
              '.az-recall-row-stale{box-shadow:inset 0 0 0 4px #f59e0b !important;border-radius:4px !important;}'+
              '.az-recall-row-missing{box-shadow:inset 0 0 0 4px #dc2626 !important;border-radius:4px !important;}'+
              '[data-az-recall-pid] [data-az-recall-pid]{box-shadow:none !important;}';
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
            var best = null;
            for (var lvl = 0; lvl < 8 && el; lvl++) {
              var t = el.textContent || '';
              var times = t.match(/@\\d{2}:\\d{2}/g);
              var hasPid = /#\\s*\\d/.test(t);
              var hasGeb = /\\d{2}\\.\\d{2}\\.\\d{4}/.test(t);
              if (hasPid && hasGeb && times && times.length === 1 && t.length < 500) {
                best = el;
              } else if (best) {
                break;
              }
              el = el.parentElement;
            }
            return best || node.parentElement;
          }
          nodes.forEach(function(node) {
            var txt = node.nodeValue;
            re.lastIndex = 0;
            var m, kind = null, pid = null;
            while ((m = re.exec(txt)) !== null) {
              var p = m[1];
              if (staleSet[p]) { kind = 'stale'; pid = p; break; }
              if (!knownSet[p]) { kind = 'missing'; pid = p; break; }
            }
            if (!kind) return;
            var row = findRow(node);
            if (!row || row.getAttribute('data-az-recall-pid')) return;
            row.setAttribute('data-az-recall-pid', pid);
            row.classList.add(kind === 'stale' ? 'az-recall-row-stale' : 'az-recall-row-missing');
            if (!row.getAttribute('title')) {
              row.setAttribute('title', kind === 'stale' ? T_STALE : T_MISSING);
              row.dataset.azRecallTitle = '1';
            }
          });
          // Anzahl der aktuell sichtbar markierten (noch nicht aktualisierten)
          // Patienten zuruecksenden -> Host zeigt eine Meldung im Panel-Kopf.
          var staleN = document.querySelectorAll('.az-recall-row-stale').length;
          var missN  = document.querySelectorAll('.az-recall-row-missing').length;
          return { stale: staleN, missing: missN };
        })();
      `
      wv.executeJavaScript(script).then(function(r: any) {
        if (r && typeof r === 'object') {
          setMarkStaleCount(r.stale || 0)
          setMarkMissingCount(r.missing || 0)
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
    // Blendet das globale 'Allgemeine Suche'-Feld (pirca-search) aus,
    // sobald eine Patientenakte offen ist (erkannt am Patient-Header).
    const toggleGlobalSearch = () => {
      wv.executeJavaScript(`(function(){
        var body = document.body ? (document.body.textContent || '') : '';
        var akteOffen = !!document.querySelector('#patient-settings, #soft-id, .patient-header-navigation');
        var search = document.querySelector('input[name="pirca-search"]');
        if(search){ var box = search.closest('form, .search') || search; var want = akteOffen ? 'none' : ''; if(box.style.display !== want) box.style.display = want; }
        var patientSel = /Patientenakte\\s*:?\\s*#|Beauftragter Arzt|Zugewiesener Standort/i.test(body);
        var pf = document.querySelector('input[placeholder*="atientensuche"]');
        if(pf){ var pbox = pf.closest('form, .search') || pf; var w2 = patientSel ? 'none' : ''; if(pbox.style.display !== w2) pbox.style.display = w2; }
      })()`).catch(() => {})
    }

    const poll = window.setInterval(() => {
      // Polling laeuft auch bevor dom-ready einmal gefeuert hat — Liris
      // koennte gerade die Login-Seite anzeigen und dabei eine andere
      // dom-ready-Sequenz benutzen. executeJavaScript schlaegt einfach
      // still fehl wenn die Seite noch nicht bereit ist.
      // 3s statt 1.5s — halbiert die Webview-IPC-Last. highlightRecallPids
      // hat zusaetzlich einen Dirty-Check (laeuft nur bei Aenderungen).
      checkCalendarDay()
      highlightRecallPids()
      toggleGlobalSearch()
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
  const todayIso = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  useEffect(() => {
    if (!staleReferenceDate || !isOpen) return
    if (staleReferenceDate >= todayIso) return  // Nur vergangene Tage
    setDayHistory(prev => {
      const newHistory = { ...prev }
      if (markStaleCount === 0 && markMissingCount === 0) {
        // Beide Zähler 0 → Tag wurde komplett bearbeitet, entfernen
        delete newHistory[staleReferenceDate]
      } else {
        // Speichere die Zähler für diesen Tag
        newHistory[staleReferenceDate] = { stale: markStaleCount, missing: markMissingCount }
      }
      return newHistory
    })
  }, [staleReferenceDate, markStaleCount, markMissingCount, todayIso, isOpen])

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
          var sel = 'input[placeholder^="Allgemeine Suche"]';
          var el = document.querySelector(sel);
          if (!el) return 'no-input-found';
          var proto = Object.getPrototypeOf(el);
          var desc = Object.getOwnPropertyDescriptor(proto, 'value');
          var setter = desc && desc.set;
          if (setter) setter.call(el, ${JSON.stringify(pid)});
          else el.value = ${JSON.stringify(pid)};
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.focus();

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
              if (hasDropdownItems()) sawItems = true;
              var res = selectFirst();
              if (res && res.indexOf('clicked') === 0) { clearInterval(iv); resolve('selected'); return; }
              if (tries >= 6) {
                clearInterval(iv);
                // Wenn nie ein Dropdown-Item erschien -> Patient nicht gefunden.
                resolve(sawItems ? 'selected' : 'no-result');
              }
            }, 350);
          });
        })();
      `
      wv.executeJavaScript(script)
        .then((res: any) => {
          console.log('[Liris] inject script done, result=', res)
          clearPendingPid()
          // Kein Suchfeld oder kein Dropdown-Treffer: Retry nach kurzer
          // Wartezeit statt sofort notFound — Liris braucht manchmal
          // laenger bis das Suchfeld sichtbar ist.
          if (res === 'no-result' || res === 'no-input-found') {
            console.log('[Liris] inject got', res, '— will retry extract')
          }
          // Extract-Timer NICHT ueber setT (=in timers-Array) anlegen —
          // clearPendingPid loest gleich einen useEffect-Re-Run aus, dessen
          // Cleanup alle Timer abraeumt. Wir wollen aber dass dieser Timer
          // fest steht. Daher window.setTimeout direkt + KEIN tracking.
          // Mehrere Versuche mit steigender Wartezeit — Liris braucht
          // manchmal lange bis die Detailseite fertig gerendert ist.
          const tryExtract = (attempt: number) => {
            const delay = attempt === 0 ? 1500 : attempt === 1 ? 3000 : 5000
            window.setTimeout(() => {
              console.log('[Liris] starting extract for pid=', pid, 'attempt', attempt + 1)
              extractLirisInfo(wv, pid).then(info => {
                console.log('[Liris] extract result:', info)
                if (info) {
                  // PID wurde ueber Dropdown ausgewaehlt — Patient existiert
                  // definitiv in Liris. pidMatchesLiris erzwingen falls die
                  // Seite beim Extract noch nicht fertig geladen war.
                  setLirisExtract({ ...info, pidMatchesLiris: true, notFound: false, at: Date.now() })
                } else if (attempt < 2) {
                  console.log('[Liris] extract empty, retrying...')
                  tryExtract(attempt + 1)
                } else {
                  // Patient wurde ueber Dropdown gefunden, also existiert er.
                  // Extract lieferte trotzdem nichts — kein notFound setzen,
                  // einfach ohne Auto-Fill weitermachen.
                  console.log('[Liris] extract empty after all retries, skipping')
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
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = resizeRef.current.startX - ev.clientX
      const newW = Math.max(300, Math.min(1200, resizeRef.current.startW + delta))
      setWidth(newW)
    }
    const onUp = () => {
      if (resizeRef.current) {
        // Endbreite persistieren, damit sie nach Neustart erhalten bleibt
        setWidth(w => { localStorage.setItem('liris-panel-width', String(w)); return w })
      }
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }


  if (!isOpen) return null

  // Aggregierte Meldung: zeige alle in dayHistory gesammelten Tage
  // (aktueller Tag + 1-2 vorherige Tage, wenn angesehen)
  const dayEntries = Object.entries(dayHistory)
    .filter(([, counts]) => counts.stale > 0 || counts.missing > 0)
    .sort(([a], [b]) => b.localeCompare(a))  // Neueste zuerst
  const hasAnyPastData = dayEntries.length > 0

  return (
    <div
      className="flex flex-row flex-shrink-0 border-l border-gray-200 bg-white relative"
      style={{ width }}
    >
      {/* Resize grip */}
      <div
        className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize z-10 hover:bg-primary-50 group"
        onMouseDown={onResizeMouseDown}
      >
        <GripVertical className="w-3 h-3 text-gray-300 group-hover:text-primary-400" />
      </div>

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
                  return (
                    <span key={date}>
                      {idx > 0 && ' · '}
                      {parts.join(' + ')}
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
            onClick={close}
            className="p-1.5 rounded hover:bg-red-50 hover:text-red-500 transition-colors ml-1"
            title="Browser schliessen"
          >
            <X className="w-3.5 h-3.5 text-gray-500" />
          </button>
        </div>

        {/* Webview — partition ist pro User, damit Liris-Logins nicht geteilt werden */}
        {/* @ts-ignore */}
        <webview
          ref={webviewRef as any}
          src={currentUrl}
          partition={partition}
          className="flex-1 w-full"
          allowpopups="true"
          disablewebsecurity="false"
          style={{ minHeight: 0 }}
        />
      </div>
    </div>
  )
}
