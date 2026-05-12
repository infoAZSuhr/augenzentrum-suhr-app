import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Pencil, X } from 'lucide-react'
import { getIVOMSchema, updateIVOMSchema } from '../../../lib/firestorePatients'
import PageHeader from '../../../components/ui/PageHeader'
import RichTextEditor from '../../../components/ui/RichTextEditor'

export default function IVOMSchema() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)

  const { data: schemaText = '', isLoading } = useQuery({
    queryKey: ['ivom-schema'],
    queryFn: getIVOMSchema,
  })

  useEffect(() => {
    if (schemaText) setDraft(schemaText)
  }, [schemaText])

  const saveMut = useMutation({
    mutationFn: () => updateIVOMSchema(draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ivom-schema'] })
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: (err: any) => alert('Fehler: ' + err.message),
  })

  const handleCancel = () => {
    setDraft(schemaText)
    setEditing(false)
  }

  if (isLoading) return <div className="p-6 text-gray-400">Laden…</div>

  return (
    <div>
      <PageHeader
        title="Schema IVI"
        subtitle="Intravitreale Injektion — Ablaufschema"
        actions={
          editing ? (
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={handleCancel}>
                <X className="w-4 h-4" /> Abbrechen
              </button>
              <button className="btn-primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                <Save className="w-4 h-4" />
                {saveMut.isPending ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          ) : (
            <button className="btn-secondary" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4" /> Bearbeiten
            </button>
          )
        }
      />

      <div className="p-3 sm:p-6 max-w-4xl">
        {saved && (
          <div className="mb-4 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">
            ✓ Schema gespeichert
          </div>
        )}

        <RichTextEditor
          content={editing ? draft : schemaText}
          onChange={setDraft}
          editable={editing}
          className="shadow-sm"
        />
      </div>
    </div>
  )
}
