import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Eye, Pencil, Trash2, FileText, Copy, Check } from 'lucide-react'
import BackButton from '../../../components/ui/BackButton'
import IVTIntervallblatt from '../components/IVTIntervallblatt'
import {
  getPatient, getPatientTreatments, createTreatment,
  updatePatient, updateTreatment, deletePatient, deleteTreatment,
} from '../../../lib/firestorePatients'
import PageHeader from '../../../components/ui/PageHeader'
import StatusBadge from '../../../components/ui/StatusBadge'
import ConfirmDialog from '../../../components/ui/ConfirmDialog'
import TreatmentForm, { type TreatmentFormValues } from '../components/TreatmentForm'
import TreatmentTimeline from '../components/TreatmentTimeline'
import PatientForm from '../components/PatientForm'
import { formatDate, daysUntil } from '../../../utils/dateUtils'
import type { Treatment } from '../../../types/ivom.types'
import { useBrowser } from '../../../contexts/BrowserContext'

const BEHANDLUNGSSTATUS_LABEL: Record<string, { label: string; color: string }> = {
  aktiv:        { label: 'Aktiv',        color: 'bg-green-100 text-green-800' },
  pausiert:     { label: 'Pausiert',     color: 'bg-yellow-100 text-yellow-800' },
  abgeschlossen:{ label: 'Abgeschlossen',color: 'bg-gray-100 text-gray-600' },
}

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [showEditPatient, setShowEditPatient] = useState(false)
  const [editTreatment, setEditTreatment] = useState<Treatment | null>(null)
  const [confirmDeletePatient, setConfirmDeletePatient] = useState(false)
  const [deleteTreatmentTarget, setDeleteTreatmentTarget] = useState<Treatment | null>(null)
  const [showIntervallblatt, setShowIntervallblatt] = useState(false)
  const [pidCopied, setPidCopied] = useState(false)
  const qc = useQueryClient()
  const { openWithPid } = useBrowser()

  const { data: patient, isLoading } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
  })

  useEffect(() => {
    if (patient?.patientNumber && (window as any).electronApp) {
      openWithPid(patient.patientNumber)
    }
  }, [patient?.patientNumber])

  const { data: treatments = [] } = useQuery({
    queryKey: ['patient-treatments', id],
    queryFn: () => getPatientTreatments(id!),
  })

  const createMut = useMutation({
    mutationFn: async (data: TreatmentFormValues) => {
      await createTreatment(data as unknown as Omit<Treatment, 'id'>)
      if (data.behandlungsStatus && id) {
        await updatePatient(id, { status: data.behandlungsStatus as any })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-treatments', id] })
      qc.invalidateQueries({ queryKey: ['patient', id] })
      qc.invalidateQueries({ queryKey: ['patients'] })
      setShowForm(false)
    },
  })

  const editPatientMut = useMutation({
    mutationFn: (data: any) => updatePatient(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', id] })
      qc.invalidateQueries({ queryKey: ['patients'] })
      setShowEditPatient(false)
    },
  })

  const deletePatientMut = useMutation({
    mutationFn: () => deletePatient(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] })
      navigate('/ivom/patienten')
    },
  })

  const editTreatmentMut = useMutation({
    mutationFn: async (data: TreatmentFormValues) => {
      await updateTreatment(editTreatment!.id, data as any)
      if (id) {
        const patch: Record<string, any> = {}
        if (data.behandlungsStatus) patch.status = data.behandlungsStatus
        if (data.nextAppointment)   patch.nextAppointmentDate = data.nextAppointment
        if (Object.keys(patch).length) await updatePatient(id, patch)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-treatments', id] })
      qc.invalidateQueries({ queryKey: ['patient', id] })
      qc.invalidateQueries({ queryKey: ['patients'] })
      setEditTreatment(null)
    },
  })

  const deleteTreatmentMut = useMutation({
    mutationFn: (tid: string) => deleteTreatment(tid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-treatments', id] })
      qc.invalidateQueries({ queryKey: ['patient', id] })
      setDeleteTreatmentTarget(null)
    },
  })

  const copyPid = () => {
    if (!patient?.patientNumber) return
    navigator.clipboard.writeText('#' + patient.patientNumber)
    setPidCopied(true)
    setTimeout(() => setPidCopied(false), 1500)
  }

  if (isLoading) return <div className="p-6 text-gray-400">Laden…</div>
  if (!patient) return <div className="p-6 text-gray-400">Patient nicht gefunden.</div>

  const nextDays = daysUntil(patient.nextAppointmentDate)
  const statusInfo = BEHANDLUNGSSTATUS_LABEL[patient.status] ?? BEHANDLUNGSSTATUS_LABEL['aktiv']

  return (
    <div>
      <PageHeader
        title={patient.firstName}
        subtitle={
          <span className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
            <span>Geb. {formatDate(patient.dateOfBirth)}</span>
            {patient.patientNumber && (
              <>
                <span>·</span>
                <button
                  onClick={copyPid}
                  className="flex items-center gap-1 hover:text-primary-600 transition-colors group"
                  title="PID kopieren"
                >
                  <span>#{patient.patientNumber}</span>
                  {pidCopied
                    ? <Check className="w-3.5 h-3.5 text-green-500" />
                    : <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
                </button>
              </>
            )}
          </span>
        }
        actions={
          <>
            <BackButton fallback="/ivom/patienten" />
            <button className="btn-secondary" onClick={() => setShowIntervallblatt(true)} title="Intervallblatt">
              <FileText className="w-4 h-4" /> <span className="hidden sm:inline">Intervallblatt</span>
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigate('/recall?tab=aufgebot')}
              title="Aufgebot- oder Reminder-Brief erstellen"
            >
              <FileText className="w-4 h-4" /> <span className="hidden sm:inline">Aufgebot-Brief</span>
            </button>
            <button className="btn-secondary" onClick={() => setShowEditPatient(true)} title="Bearbeiten">
              <Pencil className="w-4 h-4" /> <span className="hidden sm:inline">Bearbeiten</span>
            </button>
            <button
              className="px-2.5 sm:px-4 py-2 rounded-xl text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors flex items-center gap-2"
              onClick={() => setConfirmDeletePatient(true)}
              title="Patient löschen"
            >
              <Trash2 className="w-4 h-4" /> <span className="hidden sm:inline">Patient löschen</span>
            </button>
            <button className="btn-primary" onClick={() => setShowForm(true)} title="Neue Behandlung">
              <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Neue Behandlung</span>
            </button>
          </>
        }
      />

      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Diagnose */}
          <div className="card p-4 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Diagnose</p>
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-orange-500" />
              <span className="text-sm"><span className="font-medium">OD:</span> {patient.diagnosisOd || '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-blue-500" />
              <span className="text-sm"><span className="font-medium">OS:</span> {patient.diagnosisOs || '—'}</span>
            </div>
            {patient.allergies && (
              <p className="text-xs text-red-600 mt-1">⚠ Allergie: {patient.allergies}</p>
            )}
            {patient.anaesthetics && patient.anaesthetics.length > 0 && (
              <p className="text-xs text-teal-700 mt-1">💉 Anästhetikum: {patient.anaesthetics.join(', ')}</p>
            )}
          </div>

          {/* Behandlungsstatus */}
          <div className="card p-4 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Behandlungsstatus</p>
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
            <p className="text-xs text-gray-400">{treatments.length} Behandlung{treatments.length !== 1 ? 'en' : ''}</p>
          </div>

          {/* Nächster Termin */}
          <div className="card p-4 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Nächster Termin</p>
            {patient.nextAppointmentDate ? (
              <>
                <p className="text-sm font-medium">{formatDate(patient.nextAppointmentDate)}</p>
                <p className={`text-xs font-medium ${nextDays === null ? 'text-gray-400' : nextDays < 0 ? 'text-red-600' : nextDays <= 7 ? 'text-yellow-600' : 'text-green-600'}`}>
                  {nextDays === null ? '' : nextDays < 0 ? `${Math.abs(nextDays)} Tage überfällig` : nextDays === 0 ? 'Heute' : `In ${nextDays} Tagen`}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-400">Nicht geplant</p>
            )}
            <StatusBadge status={patient.status} />
          </div>
        </div>

        {treatments.length > 0 && (
          <div className="card p-5">
            <h2 className="font-semibold text-gray-800 mb-4">Behandlungsverlauf</h2>
            <TreatmentTimeline treatments={treatments} />
          </div>
        )}

        {/* Behandlungstabelle */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Behandlungen ({treatments.length})</h2>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Datum</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Art</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Auge</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Medikament</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Charge</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">OCT-Befund</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Nächster Termin</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden lg:table-cell">Durchgeführt von</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Status</th>
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {treatments.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400">Noch keine Behandlungen erfasst.</td></tr>
              ) : (
                treatments.map((t) => {
                  const bs = BEHANDLUNGSSTATUS_LABEL[(t as any).behandlungsStatus] ?? BEHANDLUNGSSTATUS_LABEL['aktiv']
                  return (
                    <tr key={t.id} className="hover:bg-gray-50 group">
                      <td className="px-4 py-3 font-medium">{formatDate(t.treatmentDate)}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {(t as any).treatmentType
                          ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">{(t as any).treatmentType}</span>
                          : <span className="text-gray-400">—</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${t.eyeSide === 'OD' ? 'text-orange-600' : 'text-blue-600'}`}>{t.eyeSide}</span>
                      </td>
                      <td className="px-4 py-3">{t.medicationName}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{t.lotNumber || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[150px] truncate hidden lg:table-cell">{t.octFindings || '—'}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">{formatDate(t.nextAppointment)}</td>
                      <td className="px-4 py-3 hidden lg:table-cell">{t.performedBy || '—'}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${bs.color}`}>{bs.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditTreatment(t)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                            title="Behandlung bearbeiten"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTreatmentTarget(t)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Behandlung löschen"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {showForm && (
        <TreatmentForm
          patientId={id!}
          onClose={() => setShowForm(false)}
          onSubmit={(data) => createMut.mutate(data)}
          isLoading={createMut.isPending}
          firstTreatmentForEyes={{
            OD: !treatments.some(t => t.eyeSide === 'OD'),
            OS: !treatments.some(t => t.eyeSide === 'OS'),
          }}
          initial={{
            eyeSide: !patient.diagnosisOd && patient.diagnosisOs ? 'OS' : 'OD',
            // Letzte Behandlung als Vorauswahl
            ...(treatments.length > 0 ? {
              inventoryArticleId: (treatments[0] as any).inventoryArticleId ?? '',
              medicationName: treatments[0].medicationName ?? '',
              setArticleId: treatments[0].setArticleId ?? '',
              setName: treatments[0].setName ?? '',
              performedBy: treatments[0].performedBy ?? '',
            } : {}),
          }}
        />
      )}

      {showEditPatient && patient && (
        <PatientForm
          initial={patient as any}
          onClose={() => setShowEditPatient(false)}
          onSubmit={(data) => editPatientMut.mutate(data)}
          isLoading={editPatientMut.isPending}
        />
      )}

      {editTreatment && (
        <TreatmentForm
          patientId={id!}
          initial={editTreatment as any}
          onClose={() => setEditTreatment(null)}
          onSubmit={(data) => editTreatmentMut.mutate(data)}
          isLoading={editTreatmentMut.isPending}
          firstTreatmentForEyes={{
            OD: treatments.filter(t => t.eyeSide === 'OD').sort((a,b) => a.treatmentDate.localeCompare(b.treatmentDate))[0]?.id === editTreatment.id,
            OS: treatments.filter(t => t.eyeSide === 'OS').sort((a,b) => a.treatmentDate.localeCompare(b.treatmentDate))[0]?.id === editTreatment.id,
          }}
        />
      )}

      {confirmDeletePatient && patient && (
        <ConfirmDialog
          title="Patient löschen?"
          message={`«${patient.firstName}${patient.patientNumber ? ` (${patient.patientNumber})` : ''}» und alle ${treatments.length} Behandlung${treatments.length !== 1 ? 'en' : ''} werden unwiderruflich gelöscht.`}
          confirmLabel="Endgültig löschen"
          isLoading={deletePatientMut.isPending}
          onConfirm={() => deletePatientMut.mutate()}
          onCancel={() => setConfirmDeletePatient(false)}
        />
      )}

      {deleteTreatmentTarget && (
        <ConfirmDialog
          title="Behandlung löschen?"
          message={`Behandlung vom ${formatDate(deleteTreatmentTarget.treatmentDate)} (${deleteTreatmentTarget.eyeSide}, ${deleteTreatmentTarget.medicationName}) wird unwiderruflich gelöscht.`}
          confirmLabel="Behandlung löschen"
          isLoading={deleteTreatmentMut.isPending}
          onConfirm={() => deleteTreatmentMut.mutate(deleteTreatmentTarget.id)}
          onCancel={() => setDeleteTreatmentTarget(null)}
        />
      )}

      {showIntervallblatt && patient && (
        <IVTIntervallblatt
          patient={patient}
          treatments={treatments}
          onClose={() => setShowIntervallblatt(false)}
        />
      )}

    </div>
  )
}
