// Schweizer QR-Rechnung (Zahlteil + Empfangsschein) für Selbstzahler-
// Rechnungen (ausländische Patienten / Barzahler ohne KK-Abrechnung).
// Der Rückforderungsbeleg wird hochgeladen, Betrag/Patient werden
// übernommen und eine QR-Rechnung auf das Praxis-Konto erstellt.
//
// Zahlungsempfänger (fix, Nutzerangabe 2026-07-20):
//   KIMENDA AG · UBS Switzerland AG, 8098 Zürich
//   IBAN: CH14 0023 4234 1869 4402 U
//
// Spez: SIX "Swiss Implementation Guidelines QR-Rechnung" v2.x —
// SPC-Payload Version 0200, Fehlerkorrektur M, Schweizerkreuz im Zentrum.
// Normale IBAN (keine QR-IBAN, IID 00234 = UBS) → Referenztyp NON,
// Zahlungszweck als unstrukturierte Mitteilung.
import QRCode from 'qrcode'

export const RECHNUNG_KONTO = {
  name: 'KIMENDA AG',
  // Postanschrift des Zahlungsempfängers (Pflichtfeld im QR-Payload).
  // Praxisadresse — falls die KIMENDA AG eine andere Rechnungsadresse
  // führt, hier anpassen.
  strasse: 'Tramstrasse 2',
  plzOrt: '5034 Suhr',
  land: 'CH',
  iban: 'CH14 0023 4234 1869 4402 U',
} as const

const ibanCompact = () => RECHNUNG_KONTO.iban.replace(/\s+/g, '')

export interface QrDebtor {
  name: string
  strasse: string
  plzOrt: string
  land?: string // ISO-2, Default CH
}

/** SPC-Payload gemäss SIX-Spezifikation (Version 0200, Adress-Typ K). */
export function buildQrPayload(betrag: number, debtor: QrDebtor, mitteilung: string): string {
  const amt = betrag.toFixed(2)
  const k = RECHNUNG_KONTO
  const lines = [
    'SPC', '0200', '1',
    ibanCompact(),
    // Zahlungsempfänger (kombinierte Adresse, Typ K)
    'K', k.name, k.strasse, k.plzOrt, '', '', k.land,
    // Endgültiger Zahlungsempfänger (leer, 7 Felder)
    '', '', '', '', '', '', '',
    amt, 'CHF',
    // Zahlungspflichtiger (Typ K)
    'K', debtor.name, debtor.strasse, debtor.plzOrt, '', '', (debtor.land || 'CH'),
    // Referenz: normale IBAN → NON, keine Referenznummer
    'NON', '',
    mitteilung.slice(0, 140),
    'EPD',
  ]
  return lines.join('\n')
}

/** QR-Code als Data-URL (PNG), Fehlerkorrektur M wie von SIX gefordert. */
export async function generateQrDataUrl(betrag: number, debtor: QrDebtor, mitteilung: string): Promise<string> {
  const payload = buildQrPayload(betrag, debtor, mitteilung)
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 0, width: 500 })
}

/** Betrag aus dem Text eines Rückforderungsbelegs extrahieren.
 *  Heuristik: grösster CHF-/Total-Betrag im Dokument (der Rückforderungs-
 *  beleg weist den Gesamtbetrag der Leistungen aus). Gibt null zurück,
 *  wenn nichts Verwertbares gefunden wird — MPA trägt dann manuell ein. */
export function parseBetragFromBeleg(text: string): number | null {
  const nums: number[] = []
  // Formate: "1'234.55", "1234.55", "1 234,55" — jeweils in der Nähe von
  // CHF/Total/Betrag, damit Datümer/PLZ nicht mitgezählt werden.
  const re = /(?:CHF|Fr\.?|Total|Betrag|Gesamtbetrag)[^\d]{0,15}(\d{1,3}(?:[' ]\d{3})*(?:[.,]\d{2})?)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[1].replace(/[' ]/g, '').replace(',', '.'))
    if (isFinite(v) && v > 0 && v < 100000) nums.push(v)
  }
  if (!nums.length) return null
  return Math.max(...nums)
}

/** Rechnungsdatum + Rechnungs-Nr. aus dem Beleg lesen. Liris-Format:
 *  "Rech.-Datum/-Nr.   21.07.2026 / 15513" — Label und Wert koennen durch
 *  Layout-Spalten getrennt sein, daher grosszuegige Luecke erlaubt. */
export function parseRechnungDatumNrFromBeleg(text: string): { datum: string | null; nr: string | null } {
  const m = text.match(/Rech\.?\s*-?\s*Datum\s*\/?\s*-?\s*Nr\.?[^\d]{0,40}(\d{2}\.\d{2}\.\d{4})\s*\/\s*([A-Za-z0-9-]+)/i)
  if (m) return { datum: m[1], nr: m[2] }
  // Fallback: getrennte Felder ("Rechnungsdatum: ..." / "Rechnungs-Nr.: ...")
  const d = text.match(/Rechnungs?-?\s*[Dd]atum[^\d]{0,20}(\d{2}\.\d{2}\.\d{4})/)
  const n = text.match(/Rechnungs?-?\s*(?:Nr|Nummer)\.?[^\dA-Za-z]{0,20}([A-Za-z0-9-]{3,})/)
  return { datum: d ? d[1] : null, nr: n ? n[1] : null }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** Zahlteil + Empfangsschein als HTML (unten auf der A4-Rechnungsseite).
 *  Vereinfachtes, aber spezifikationsnahes Layout (105mm hoch, Trennlinie,
 *  Empfangsschein links / Zahlteil rechts, Schweizerkreuz im QR). */
export function buildZahlteilHtml(qrDataUrl: string, betrag: number, debtor: QrDebtor): string {
  const k = RECHNUNG_KONTO
  const amt = betrag.toFixed(2)
  const kontoBlock = `${esc(k.name)}<br>${esc(k.strasse)}<br>${esc(k.plzOrt)}`
  const debtorBlock = `${esc(debtor.name)}<br>${esc(debtor.strasse)}<br>${esc(debtor.plzOrt)}`
  return `
  <div style="position:absolute;left:0;right:0;bottom:0;height:10.5cm;border-top:1px dashed #000;background:#fff;font-family:Arial,Helvetica,sans-serif;display:flex">
    <div style="width:6.2cm;border-right:1px dashed #000;padding:.5cm;font-size:8pt">
      <div style="font-size:11pt;font-weight:bold;margin-bottom:.3cm">Empfangsschein</div>
      <div style="font-weight:bold;font-size:6pt">Konto / Zahlbar an</div>
      <div style="margin-bottom:.25cm">${esc(k.iban)}<br>${kontoBlock}</div>
      <div style="font-weight:bold;font-size:6pt">Zahlbar durch</div>
      <div style="margin-bottom:.35cm">${debtorBlock}</div>
      <table style="width:100%;font-size:8pt"><tr>
        <td><span style="font-weight:bold;font-size:6pt">W&#228;hrung</span><br>CHF</td>
        <td><span style="font-weight:bold;font-size:6pt">Betrag</span><br>${amt}</td>
      </tr></table>
      <div style="text-align:right;font-weight:bold;font-size:6pt;margin-top:.5cm">Annahmestelle</div>
    </div>
    <div style="flex:1;padding:.5cm;display:flex;gap:.5cm">
      <div>
        <div style="font-size:11pt;font-weight:bold;margin-bottom:.3cm">Zahlteil</div>
        <div style="position:relative;width:4.6cm;height:4.6cm">
          <img src="${qrDataUrl}" style="width:4.6cm;height:4.6cm" alt="QR-Code">
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:.7cm;height:.7cm;background:#000;display:flex;align-items:center;justify-content:center">
            <div style="position:relative;width:.35cm;height:.35cm">
              <div style="position:absolute;left:38%;top:0;width:24%;height:100%;background:#fff"></div>
              <div style="position:absolute;top:38%;left:0;width:100%;height:24%;background:#fff"></div>
            </div>
          </div>
        </div>
        <table style="font-size:10pt;margin-top:.35cm"><tr>
          <td style="padding-right:.4cm"><span style="font-weight:bold;font-size:8pt">W&#228;hrung</span><br>CHF</td>
          <td><span style="font-weight:bold;font-size:8pt">Betrag</span><br>${amt}</td>
        </tr></table>
      </div>
      <div style="font-size:10pt;flex:1">
        <div style="font-weight:bold;font-size:8pt">Konto / Zahlbar an</div>
        <div style="margin-bottom:.3cm">${esc(k.iban)}<br>${kontoBlock}</div>
        <div style="font-weight:bold;font-size:8pt">Zahlbar durch</div>
        <div>${debtorBlock}</div>
      </div>
    </div>
  </div>`
}
