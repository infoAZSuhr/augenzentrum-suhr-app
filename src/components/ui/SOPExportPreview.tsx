import { useMemo } from 'react'
import { X, Printer, FileDown } from 'lucide-react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { buildFullHtml, exportPagePDF, exportPageDocx, type ExportPageInput } from '../../lib/sopExport'

interface Props {
  page: ExportPageInput
  onClose: () => void
}

export default function SOPExportPreview({ page, onClose }: Props) {
  useEscapeKey(onClose)

  // Vorschau-HTML wird einmal gebaut und gecached
  const html = useMemo(() => buildFullHtml(page), [page])

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
              <span className="truncate">{page.title}</span>
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
              onClick={() => exportPageDocx(page)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg font-medium transition-colors"
              title="Als Word-Datei herunterladen"
            >
              <FileDown className="w-4 h-4" />
              Word
            </button>
            <button
              onClick={() => exportPagePDF(page)}
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
