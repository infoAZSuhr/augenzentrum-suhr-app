import { LOGO_AZS_BASE64 } from './logoBase64'

/** Gemeinsame Praxis-Briefvorlage (Briefkopf + CSS + Adressfenster + Signatur).
 *  Wird von Recall (indirekt) und vom IVI-Modul genutzt. Der eigentliche
 *  Brieftext wird als fertiges HTML (`bodyHtml`) übergeben. */

const GERMAN_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export interface PraxisBriefOpts {
  anrede: string          // 'Herr' | 'Frau' | 'Familie' | '' (für das Adressfenster)
  nameDisplay: string     // 'Vorname Nachname' (Adressfenster)
  addressLine2?: string   // Strasse Nr.
  addressLine3?: string   // PLZ Ort
  title: string           // Betreff
  bodyHtml: string        // innerer Brief-Body inkl. Anrede-Absatz
}

/** Anrede-Höflichkeitsform für «Sehr geehrte…» */
export function anredeForm(anrede: string): string {
  return anrede === 'Herr' ? 'geehrter Herr'
    : anrede === 'Familie' ? 'geehrte Familie'
    : anrede === 'Frau' ? 'geehrte Frau'
    : 'geehrte Damen und Herren'
}

export function buildPraxisBriefHtml(opts: PraxisBriefOpts): string {
  const today = new Date()
  const dateStr = `${today.getDate()}. ${GERMAN_MONTHS[today.getMonth()]} ${today.getFullYear()}`
  const logoDataUrl = LOGO_AZS_BASE64
  const adressHtml = [opts.anrede, opts.nameDisplay, opts.addressLine2 ?? '', opts.addressLine3 ?? '']
    .map(l => (l || '').trim()).filter(Boolean).join('<br>')

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><title>Brief</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111;background:#fff}
  .page{width:21cm;height:29.7cm;max-height:29.7cm;overflow:hidden;padding:1.2cm 2.2cm 2cm 2.5cm;margin:auto}
  .letterhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:-0.1cm}
  .lh-left{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;max-width:7.5cm}
  .lh-logo{height:1.9cm;width:auto;max-width:7.5cm;object-fit:contain;display:block;margin-bottom:.45cm}
  .lh-praxisname{font-size:12pt;font-weight:bold;color:#1a3a6e;margin-bottom:.1cm;letter-spacing:.02em}
  .lh-addr{font-size:9.5pt;color:#1a3a6e;letter-spacing:.03em;margin-bottom:.18cm;font-weight:600}
  .lh-contact-left{font-size:9pt;line-height:1.5;color:#1a3a6e}
  .lh-right{display:flex;flex-direction:column;align-items:flex-end}
  .addr-row{display:flex;justify-content:flex-end;margin-bottom:.9cm}
  .addrwin{width:8.5cm;font-size:10.5pt;line-height:1.25;margin-right:-1.5cm}
  .right-col{display:flex;justify-content:flex-end}
  .right-col-inner{width:8.5cm;margin-right:-1.5cm}
  .dateline{margin-bottom:1.4cm;font-size:10.5pt}
  .subject{font-size:11pt;font-weight:bold;margin-bottom:1cm}
  .body p{margin-bottom:.3cm;line-height:1.15}
  .salut{margin-bottom:.45cm !important}
  .termin-box-wrap{text-align:center;margin:.4cm 0 .3cm}
  .termin-box{border:1.5px solid #333;border-radius:4px;padding:.35cm .6cm;display:inline-block;text-align:left}
  .termin-box-label{font-size:8pt;font-weight:bold;text-transform:uppercase;letter-spacing:.04em;color:#1a3a6e;margin-bottom:.15cm}
  .termin-box-date{font-size:12pt;font-weight:bold;color:#111}
  .body a{color:#111;text-decoration:none;font-weight:bold}
  .sig{margin-top:1.8cm;line-height:1.7}
  .sig .gruss{margin-bottom:.4cm}
  @page{margin:0;size:A4}
  @media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><div class="page">

  <div class="letterhead">
    <div class="lh-left">
      ${logoDataUrl ? `<img class="lh-logo" src="${logoDataUrl}" alt="Augenzentrum Suhr">` : '<div class="lh-praxisname">Augenzentrum Suhr</div>'}
      <div class="lh-addr">Tramstrasse 2, 5034 Suhr</div>
      <div class="lh-contact-left">
        Tel. +41 62 842 18 46<br>
        info@augenzentrum-suhr.ch<br>
        www.augenzentrum-suhr.ch
      </div>
    </div>
    <div class="lh-right"></div>
  </div>

  <div class="addr-row">
    <div class="addrwin">
      ${adressHtml}
    </div>
  </div>

  <div class="right-col"><div class="right-col-inner dateline">Suhr,&nbsp; ${dateStr}</div></div>
  <div class="subject">${opts.title}</div>

  <div class="body">
    ${opts.bodyHtml}
  </div>

  <div class="right-col"><div class="right-col-inner sig">
    <p class="gruss">Freundliche Gr&#252;sse</p>
    <p>Augenzentrum Suhr Team</p>
  </div></div>

</div>
</body></html>`
}

/** Datum (YYYY-MM-DD) + optionale Zeit (HH:MM) als deutsches Langformat. */
export function formatTerminLong(dateIso: string, zeit?: string): string {
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
  const d = new Date(dateIso + 'T00:00:00')
  if (isNaN(d.getTime())) return dateIso
  return `${days[d.getDay()]}, ${d.getDate()}. ${GERMAN_MONTHS[d.getMonth()]} ${d.getFullYear()}${zeit ? ` um ${zeit} Uhr` : ''}`
}
