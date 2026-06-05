export interface Patient {
  id: string
  lastName?: string
  firstName: string
  dateOfBirth: string
  gender: 'M' | 'W' | 'D'
  patientNumber?: string
  insuranceNumber?: string
  insuranceName?: string
  diagnosisOd?: string
  diagnosisOs?: string
  allergies?: string
  anaesthetics?: string[]
  notes?: string
  status: 'aktiv' | 'pausiert' | 'abgeschlossen'
  createdAt?: string
  updatedAt?: string
  // computed
  lastTreatmentDate?: string
  nextAppointmentDate?: string
  treatmentCount?: number
}

export interface Treatment {
  id: string
  patientId: string
  treatmentDate: string
  eyeSide: 'OD' | 'OS'
  medicationId?: string
  medicationName: string
  lotNumber?: string
  inventoryLotId?: string
  vaBefore?: string
  vaAfter?: string
  vaUnit: 'dezimal' | 'snellen' | 'logmar'
  octCentralThicknessBefore?: number
  octCentralThicknessAfter?: number
  octFindings?: string
  nextAppointment?: string
  nextIntervalWeeks?: number
  erstesOctDatum?: string
  kontrolldatum?: string
  kontrolldatumAmSpritztag?: boolean
  performedBy?: string
  notes?: string
  behandlungsStatus: 'aktiv' | 'pausiert' | 'abgeschlossen'
  setArticleId?: string
  setName?: string
  setLotId?: string
  setLotNumber?: string
  createdAt?: string
}

export interface Appointment {
  id: string
  patientId: string
  scheduledDate: string
  appointmentType: 'IVOM' | 'Kontrolle' | 'OCT'
  eyeSide?: 'OD' | 'OS'
  linkedTreatmentId?: string
  status: 'geplant' | 'erschienen' | 'abgesagt' | 'verschoben'
  notes?: string
  // joined
  patientName?: string
}

export interface Medication {
  id: string
  name: string
  activeIngredient?: string
  standardIntervalWeeks?: number | null
  isActive: boolean
}
