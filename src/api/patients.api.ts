import client from './client'
import type { Patient, Treatment, Appointment } from '../types/ivom.types'

export const patientsApi = {
  list: (params?: { search?: string; status?: string }) =>
    client.get<Patient[]>('/patients', { params }).then((r) => r.data),

  get: (id: number) =>
    client.get<Patient>(`/patients/${id}`).then((r) => r.data),

  create: (data: Omit<Patient, 'id'>) =>
    client.post<Patient>('/patients', data).then((r) => r.data),

  update: (id: number, data: Partial<Patient>) =>
    client.put<Patient>(`/patients/${id}`, data).then((r) => r.data),

  getTreatments: (id: number) =>
    client.get<Treatment[]>(`/patients/${id}/treatments`).then((r) => r.data),

  getAppointments: (id: number) =>
    client.get<Appointment[]>(`/patients/${id}/appointments`).then((r) => r.data),
}
