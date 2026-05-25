import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, Users } from 'lucide-react'
import { getPatients, createPatient, deletePatient } from '../../../lib/firestorePatients'
import PageHeader from '../../../components/ui/PageHeader'
import StatusBadge from '../../../components/ui/StatusBadge'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import EmptyState from '../../../components/ui/EmptyState'
import TableSkeleton from '../../../components/ui/TableSkeleton'
import { formatDate } from '../../../utils/dateUtils'
import PatientForm from '../components/PatientForm'
import type { Patient } from '../../../types/ivom.types'

type SortKey = 'name' | 'patientNumber' | 'dateOfBirth' | 'lastTreatmentDate' | 'nextAppointmentDate' | 'status'

function sortPatients(patients: Patient[], key: SortKey | null, dir: 'asc' | 'desc'): Patient[] {
  if (!key) return patients
  return [...patients].sort((a, b) => {
    let va: string, vb: string
    if (key === 'name') {
      va = `${a.lastName} ${a.firstName}`.toLowerCase()
      vb = `${b.lastName} ${b.firstName}`.toLowerCase()
    } else {
      va = (a[key as keyof Patient] as string) ?? ''
      vb = (b[key as keyof Patient] as string) ?? ''
    }
    if (!va && vb) return 1
    if (va && !vb) return -1
    const cmp = va.localeCompare(vb, 'de')
    return dir === 'asc' ? cmp : -cmp
  })
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />
  return dir === 'asc'
    ? <ChevronUp className="w-3.5 h-3.5 text-primary-600" />
    : <ChevronDown className="w-3.5 h-3.5 text-primary-600" />
}

export default function PatientList() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'alle' | 'aktiv' | 'abgeschlossen'>('aktiv')
  const [showForm, setShowForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Patient | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>('nextAppointmentDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: patients = [], isLoading, error } = useQuery({
    queryKey: ['patients', search, statusFilter],
    queryFn: () => getPatients(search || undefined, statusFilter === 'alle' ? undefined : statusFilter),
  })

  const sortedPatients = useMemo(() => sortPatients(patients, sortKey, sortDir), [patients, sortKey, sortDir])

  const createMut = useMutation({
    mutationFn: (data: Omit<Patient, 'id'>) => createPatient(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patients'] }); setShowForm(false) },
    onError: (err: any) => alert('Fehler beim Speichern: ' + err.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePatient(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patients'] }); setDeleteTarget(null) },
    onError: (err: any) => alert('Fehler beim Löschen: ' + (err as any).message),
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const Th = ({ label, sortable, className }: { label: string; sortable?: SortKey; className?: string }) => {
    if (!sortable) return <th className={`text-left px-4 py-3 font-medium text-gray-600 ${className ?? ''}`}>{label}</th>
    return (
      <th
        className={`text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900 hover:bg-gray-100 transition-colors ${className ?? ''}`}
        onClick={() => handleSort(sortable)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <SortIcon active={sortKey === sortable} dir={sortDir} />
        </span>
      </th>
    )
  }

  return (
    <div>
      <PageHeader
        title="IVI-Manager"
        subtitle={`${patients.length} Patient${patients.length !== 1 ? 'en' : ''}`}
        actions={
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> Neuer Patient
          </button>
        }
      />

      <div className="p-3 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9 w-full" placeholder="Name suchen…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs sm:text-sm self-start">
            {(['alle', 'aktiv', 'abgeschlossen'] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 sm:px-4 py-2 font-medium transition-colors ${statusFilter === s ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-10">#</th>
                  <Th label="PID" sortable="patientNumber" className="hidden sm:table-cell" />
                  <Th label="Name" sortable="name" />
                  <Th label="Geburtsdatum" sortable="dateOfBirth" className="hidden sm:table-cell" />
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Diagnose OD</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Diagnose OS</th>
                  <Th label="Letzte Beh." sortable="lastTreatmentDate" className="hidden lg:table-cell" />
                  <Th label="Nächster Termin" sortable="nextAppointmentDate" className="hidden sm:table-cell" />
                  <Th label="Status" sortable="status" />
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <TableSkeleton columns={10} />
                ) : error ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-red-500">Fehler: {(error as any).message}</td></tr>
                ) : sortedPatients.length === 0 ? (
                  <tr><td colSpan={10}>
                    <EmptyState
                      icon={Users}
                      title={search || statusFilter !== 'alle' ? 'Keine Patienten gefunden' : 'Noch keine Patienten erfasst'}
                      description={search || statusFilter !== 'alle' ? 'Versuche, die Suche oder den Status-Filter anzupassen.' : 'Lege deinen ersten Patienten an, um zu starten.'}
                      action={!search && statusFilter === 'alle' && (
                        <button className="btn-primary" onClick={() => setShowForm(true)}>
                          <Plus className="w-4 h-4" /> Neuer Patient
                        </button>
                      )}
                    />
                  </td></tr>
                ) : (
                  sortedPatients.map((p, idx) => (
                    <tr
                      key={p.id}
                      className="hover:bg-primary-50 cursor-pointer transition-colors group"
                      onClick={() => navigate(`/ivom/${p.id}`)}
                    >
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono">{idx + 1}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs hidden sm:table-cell">
                        {p.patientNumber || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900 group-hover:text-primary-700 transition-colors">
                          {p.lastName}, {p.firstName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{formatDate(p.dateOfBirth)}</td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{p.diagnosisOd || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{p.diagnosisOs || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">{formatDate(p.lastTreatmentDate)}</td>
                      <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{formatDate(p.nextAppointmentDate)}</td>
                      <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Link
                            to={`/ivom/${p.id}`}
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
                          >
                            Öffnen →
                          </Link>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(p) }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Patient löschen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showForm && (
        <PatientForm
          onClose={() => setShowForm(false)}
          onSubmit={(data) => createMut.mutate(data as Omit<Patient, 'id'>)}
          isLoading={createMut.isPending}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Patient löschen?"
          message={`«${deleteTarget.lastName}, ${deleteTarget.firstName}» und alle zugehörigen Behandlungen werden unwiderruflich gelöscht.`}
          confirmLabel="Endgültig löschen"
          isLoading={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
