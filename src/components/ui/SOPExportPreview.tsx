import { useMemo, useState } from 'react'
import { X, Printer, FileDown, FileText, Folder, FolderOpen } from 'lucide-react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import {
  buildFullHtml, exportPagePDF, exportPageDocx,
  buildMultiHtml, exportMultiplePDF, exportMultipleDocx,
  type ExportPageInput, type MultiExportInput,
} from '../../lib/sopExport'

export type ExportScope = 'page' | 'subsection' | 'section'

interface Props {
  /** Hauptseite die im 'page'-Scope exportiert wird */
  page: ExportPageInput
  /** Alle FINALEN Pages der enthaltenden Subsection (sortiert, inkl. der aktiven). */
  subsectionPages?:  ExportPageInput[]
  subsectionTitle?:  string
  /** Alle FINALEN Pages der enthaltenden Section (sortiert). */
  sectionPages?:     ExportPageInput[]
  sectionTitle?:     string
  /** Zusätzlich: die Drafts der Subsection (nicht freigegeben). Werden NUR
   *  beim "Drafts einschliessen"-Toggle in den Bulk-Export mitgenommen.
   *  Macht den Selector auch dann sinnvoll wenn noch nichts final ist. */
  subsectionDrafts?: ExportPageInput[]
  sectionDrafts?:    ExportPageInput[]
  defaultScope?:     ExportScope
  onClose: () => void
}

export default function SOPExportPreview({
  page,
  subsectionPages, subsectionTitle,
  sectionPages,    sectionTitle,
  subsectionDrafts, sectionDrafts,
  defaultScope = 'page',
  onClose,
}: Props) {
  useEscapeKey(onClose)
  const [scope, setScope] = useState<ExportScope>(defaultScope)
  const [includeDrafts, setIncludeDrafts] = useState(false)

  // Pages je nach Scope, plus optionale Drafts beim Bulk-Modus
  const finalsForScope = scope === 'subsection' ? (subsectionPages ?? [])
                       : scope === 'section'    ? (sectionPages    ?? [])
                       :                          []
  const draftsForScope = scope === 'subsection' ? (subsectionDrafts ?? [])
                       : scope === 'section'    ? (sectionDrafts    ?? [])
                       :                          []
  const activeBulk = scope === 'page'
                   ? undefined
                   : includeDrafts ? [...finalsForScope, ...draftsForScope] : finalsForScope
  const activeBulkTitle = scope === 'subsection' ? (subsectionTitle ?? 'Subsection-Export')
                       : scope === 'section'     ? (sectionTitle    ?? 'Section-Export')
                       :                            page.title
  const isMulti = scope !== 'page' && activeBulk && activeBulk.length > 0
  const exportTitle = activeBulkTitle

  const html = useMemo(() => {
    if (isMulti) {
      const multi: MultiExportInput = {
        title:    exportTitle,
        subtitle: scope === 'section' ? 'Section-Export' : 'Subsection-Export',
        pages:    activeBulk!,
        withToc:  activeBulk!.length > 2,
        glossar:  page.glossar,
      }
      return buildMultiHtml(multi)
    }
    return buildFullHtml(page)
  }, [scope, isMulti, activeBulk, exportTitle, page])

  const handlePDF = () => {
    if (isMulti) {
      exportMultiplePDF({
        title:    exportTitle,
        subtitle: scope === 'section' ? 'Section-Export' : 'Subsection-Export',
        pages:    activeBulk!,
        withToc:  activeBulk!.length > 2,
        glossar:  page.glossar,
      })
    } else {
      exportPagePDF(page)
    }
  }
  const handleDocx = () => {
    if (isMulti) {
      exportMultipleDocx({
        title:    exportTitle,
        subtitle: scope === 'section' ? 'Section-Export' : 'Subsection-Export',
        pages:    activeBulk!,
        withToc:  activeBulk!.length > 2,
        glossar:  page.glossar,
      })
    } else {
      exportPageDocx(page)
    }
  }

  // Counts pro Scope für die Pills (final + draft)
  const subsectionFinalN = subsectionPages?.length  ?? 0
  const subsectionDraftN = subsectionDrafts?.length ?? 0
  const sectionFinalN    = sectionPages?.length     ?? 0
  const sectionDraftN    = sectionDrafts?.length    ?? 0
  // Selector zeigen wir IMMER — auch wenn der Bulk-Modus für eine SOP nicht
  // mehr exportieren würde als die einzelne Page, soll der User das selbst
  // sehen können (statt zu glauben das Feature fehlt).
  const hasAnyBulkData = subsectionFinalN + subsectionDraftN > 1 || sectionFinalN + sectionDraftN > 1
  const draftsAvailable = subsectionDraftN > 0 || sectionDraftN > 0
  const pageCount = isMulti ? activeBulk!.length : 1

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-none sm:rounded-2xl shadow-2xl w-full sm:max-w-4xl flex flex-col h-full sm:max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                Vorschau
              </span>
              <span className="truncate">{exportTitle}</span>
              {isMulti && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                  {pageCount} Seiten
                </span>
              )}
            </h2>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">
              So wird die Datei beim Export aussehen
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
            title="Schliessen (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scope-Auswahl — IMMER sichtbar damit der User die Option kennt.
            Pills zeigen die Anzahl finaler SOPs (rot wenn nichts da). Drafts-
            Toggle erscheint nur wenn überhaupt Drafts existieren. */}
        <div className="px-5 py-2.5 border-b border-gray-100 shrink-0 bg-gray-50/60">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mr-1">Umfang:</span>
            {[
              { key: 'page',       label: 'Nur diese Seite', Icon: FileText,   count: 1,                                                  effective: 1 },
              { key: 'subsection', label: 'Subsection',      Icon: Folder,     count: subsectionFinalN,  draftCount: subsectionDraftN,    effective: subsectionFinalN + (includeDrafts ? subsectionDraftN : 0) },
              { key: 'section',    label: 'Section',         Icon: FolderOpen, count: sectionFinalN,     draftCount: sectionDraftN,       effective: sectionFinalN    + (includeDrafts ? sectionDraftN    : 0) },
            ].map(({ key, label, Icon, count, draftCount, effective }) => {
              const isActive = scope === key
              const isDisabled = key !== 'page' && effective === 0
              const title = key === 'page'
                ? 'Nur die aktuell offene SOP'
                : isDisabled
                  ? `Keine finalen SOPs in dieser ${key === 'subsection' ? 'Subsection' : 'Section'}${draftCount ? ` (${draftCount} Entwurf-Status — "Drafts einschliessen" aktivieren)` : ''}`
                  : `${count} finale${count === 1 ? '' : ''}${draftCount && includeDrafts ? ` + ${draftCount} Entwurf` : ''}`
              return (
                <button
                  key={key}
                  onClick={() => !isDisabled && setScope(key as ExportScope)}
                  disabled={isDisabled}
                  title={title}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors
                    ${isActive
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white'}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {key !== 'page' && (
                    <span className={`text-[10px] tabular-nums px-1 rounded ${isActive ? 'bg-white/25' : 'bg-gray-100 text-gray-500'}`}>
                      {effective}
                    </span>
                  )}
                </button>
              )
            })}
            {draftsAvailable && scope !== 'page' && (
              <label className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] text-gray-600 cursor-pointer select-none ml-1">
                <input type="checkbox" checked={includeDrafts} onChange={e => setIncludeDrafts(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-400" />
                Entwürfe einschliessen ({(scope === 'subsection' ? subsectionDraftN : sectionDraftN)})
              </label>
            )}
            {isMulti && (
              <span className="text-[11px] text-gray-500 ml-auto">
                {pageCount} SOPs werden zusammen exportiert
                {pageCount > 2 && ' · mit Inhaltsverzeichnis'}
              </span>
            )}
            {!hasAnyBulkData && scope === 'page' && (
              <span className="text-[11px] text-gray-400 ml-auto italic">
                Subsection/Section enthalten nur diese eine SOP.
              </span>
            )}
          </div>
        </div>

        {/* Iframe-Vorschau */}
        <div className="flex-1 overflow-hidden bg-gray-100 p-2 sm:p-4">
          <iframe
            title="SOP-Vorschau"
            srcDoc={html}
            sandbox="allow-same-origin"
            className="w-full h-full bg-white shadow-sm rounded-md border border-gray-200"
          />
        </div>

        {/* Footer mit Export-Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 px-5 py-3 border-t border-gray-200 shrink-0 bg-gray-50">
          <p className="text-[11px] text-gray-500 leading-tight">
            <span className="font-medium">Tipp:</span> «PDF» öffnet den Druckdialog (dort «Als PDF speichern» wählen). «Word» lädt eine .doc-Datei herunter, die du in Microsoft Word weiterbearbeiten kannst.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={handleDocx}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg font-medium transition-colors"
              title="Als Word-Datei herunterladen"
            >
              <FileDown className="w-4 h-4" />
              Word
            </button>
            <button
              onClick={handlePDF}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors"
              title="Druckdialog öffnen"
            >
              <Printer className="w-4 h-4" />
              PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
