// Arztfotos für die «neuer Arzt vorschlagen»-Briefvariante.
//
// Das Foto wird NUR auf dem Brief angezeigt, wenn ein bestehender Patient
// einem neuen Arzt vorgestellt wird (form.briefVariante === 'neuerArzt').
// Es erscheint unmittelbar neben dem vorgeschlagenen Termin.
//
// Das Foto wird – wie bei Materialien in der Lagerverwaltung – als LINK (URL)
// hinterlegt und per <img src="…"> geladen. Bevorzugt kommt die URL aus dem
// Arzt-Profil (users-Sammlung, Feld `fotoUrl`); fehlt sie dort, greift die
// folgende Code-Tabelle als Fallback.
//
// Key = Arzt-Nachname (identisch zu DOCTORS_DEFAULT in RecallPage).
// Wert = Bild-URL (z.B. 'https://…/artemiev.jpg') oder '' = kein Foto.
export const DOCTOR_PHOTOS: Record<string, string> = {
  Artemiev:   '',
  Menke:      '',
  Malinina:   '',
  Tschopp:    '',
  Trachsler:  '',
  Kirr:       '',
  Papazoglou: '',
}

/** Foto-URL für einen Arzt-Nachnamen. `override` (z.B. aus dem Profil)
 *  hat Vorrang vor der Code-Tabelle. '' wenn kein Foto. */
export function doctorPhoto(doctor: string | null | undefined, override?: string): string {
  if (override && override.trim()) return override.trim()
  if (!doctor) return ''
  return DOCTOR_PHOTOS[doctor] || ''
}
