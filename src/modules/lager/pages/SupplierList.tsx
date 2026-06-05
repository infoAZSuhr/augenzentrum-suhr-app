import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Phone, Mail, MapPin, Globe, Trash2 } from 'lucide-react'
import { getSuppliers, createSupplier, updateSupplier, deleteSupplier, type Supplier } from '../../../lib/firestoreLager'
import PageHeader from '../../../components/ui/PageHeader'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import SupplierForm from '../components/SupplierForm'

export default function SupplierList() {
  const [showForm, setShowForm] = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null)
  const qc = useQueryClient()

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: getSuppliers,
  })

  const createMut = useMutation({
    mutationFn: (data: Omit<Supplier, 'id'>) => createSupplier(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setShowForm(false) },
  })

  const updateMut = useMutation({
    mutationFn: (data: Omit<Supplier, 'id'>) => updateSupplier(editSupplier!.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setEditSupplier(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSupplier(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setDeleteTarget(null) },
  })

  return (
    <div>
      <PageHeader
        title="Lieferanten"
        subtitle={`${suppliers.length} Lieferant${suppliers.length !== 1 ? 'en' : ''}`}
        actions={
          <button className="btn-primary" onClick={() => setShowForm(true)} title="Neuer Lieferant">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Neuer Lieferant</span>
          </button>
        }
      />

      <div className="p-6">
        {isLoading ? (
          <p className="text-gray-400 text-center py-12">Laden…</p>
        ) : suppliers.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <p className="text-lg font-medium">Noch keine Lieferanten erfasst</p>
            <p className="text-sm mt-1">Klicke auf «Neuer Lieferant» um den ersten hinzuzufügen.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.map(s => (
              <div key={s.id} className="card p-5 space-y-3 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{s.name}</h3>
                    {s.contact && <p className="text-sm text-gray-500 mt-0.5">{s.contact}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditSupplier(s)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                      title="Bearbeiten">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteTarget(s)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Löschen">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {s.phone && (
                    <a href={`tel:${s.phone}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600">
                      <Phone className="w-3.5 h-3.5 text-gray-400" /> {s.phone}
                    </a>
                  )}
                  {s.email && (
                    <a href={`mailto:${s.email}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600">
                      <Mail className="w-3.5 h-3.5 text-gray-400" /> {s.email}
                    </a>
                  )}
                  {s.website && (
                    <a href={s.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600">
                      <Globe className="w-3.5 h-3.5 text-gray-400" /> {s.website}
                    </a>
                  )}
                  {s.address && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /> {s.address}
                    </div>
                  )}
                </div>
                {s.notes && (
                  <p className="text-xs text-gray-400 border-t border-gray-100 pt-2">{s.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <SupplierForm
          onClose={() => setShowForm(false)}
          onSubmit={(d) => createMut.mutate(d)}
          isLoading={createMut.isPending}
        />
      )}
      {editSupplier && (
        <SupplierForm
          initial={editSupplier}
          onClose={() => setEditSupplier(null)}
          onSubmit={(d) => updateMut.mutate(d)}
          isLoading={updateMut.isPending}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Lieferant löschen?"
          message={`«${deleteTarget.name}» wird unwiderruflich gelöscht.`}
          confirmLabel="Lieferant löschen"
          isLoading={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
