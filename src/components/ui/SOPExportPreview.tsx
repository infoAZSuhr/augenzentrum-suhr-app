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
  /** Alle Pages der enthaltenden Subsection (sortiert, inkl. der aktiven). */
  subsectionPages?:  ExportPageInput[]
  subsectionTitle?:  string
  /** Alle Pages der enthaltenden Section (sortiert). */
  sectionPages?:     ExportPageInput[]
  sectionTitle?:     string
  defaultScope?:     ExportScope
  onClose: () => void
}

export default function SOPExportPreview({
  page,
  subsectionPages, subsectionTitle,
  sectionPages,    sectionTitle,
  defaultScope = 'page',
  onClose,
}: Props) {
  useEscapeKey(onClose)
  const [scope, setScope] = useState<ExportScope>(defaultScope)

  // Pages + Titel je nach gewähltem Scope
  const activeBulk = scope === 'subsection' ? subsectionPages
                    : scope === 'section'    ? sectionPages
                    :                          undefined
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

  const bulkAvailable = (subsectionPages?.length ?? 0) > 1 || (sectionPages?.length ?? 0) > 1
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

        {/* Scope-Auswahl — nur wenn Bulk-Pages verfügbar sind. Bei einzelner
            Page-Export-Aktion zeigen wir keine Auswahl (verwirrend). */}
        {bulkAvailable && (
          <div className="px-5 py-2.5 border-b border-gray-100 shrink-0 bg-gray-50/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mr-1">Umfang:</span>
              {[
                { key: 'page',       label: 'Nur diese Seite', Icon: FileText },
                { key: 'subsection', label: 'Ganze Subsection', Icon: Folder },
                { key: 'section',    label: 'Ganze Section',    Icon: FolderOpen },
              ].map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setScope(key as ExportScope)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors
                    ${scope === key
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
              {isMulti && (
                <span className="text-[11px] text-gray-500 ml-auto">
                  {pageCount} SOPs werden zusammen exportiert
                  {pageCount > 2 && ' · mit Inhaltsverzeichnis'}
                </span>
              )}
            </div>
          </div>
        )}

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
