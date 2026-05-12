import client from './client'
import type { Treatment, Appointment, Medication } from '../types/ivom.types'

export const treatmentsApi = {
  create: (data: Omit<Treatment, 'id'>) =>
    client.post<Treatment>('/treatments', data).then((r) => r.data),

  update: (id: number, data: Partial<Treatment>) =>
    client.put<Treatment>(`/treatments/${id}`, data).then((r) => r.data),

  getUpcoming: (days = 7) =>
    client.get<Appointment[]>('/treatments/upcoming', { params: { days } }).then((r) => r.data),

  getOverdue: () =>
    client.get<{ patient: string; patientId: number; nextAppointment: string }[]>('/treatments/overdue').then((r) => r.data),

  getMedications: () =>
    client.get<Medication[]>('/medications').then((r) => r.data),
}
