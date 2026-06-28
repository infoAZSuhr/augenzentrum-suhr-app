// Arztfotos für die «neuer Arzt vorschlagen»-Briefvariante.
//
// Das Foto wird NUR auf dem Brief angezeigt, wenn ein bestehender Patient
// einem neuen Arzt vorgestellt wird (form.briefVariante === 'neuerArzt').
//
// Key = Arzt-Nachname (identisch zu DOCTORS_DEFAULT in RecallPage).
// Wert = Bild als Data-URL (z.B. 'data:image/jpeg;base64,/9j/4AAQ…').
// Leerer String ('') = kein Foto → es wird nichts angezeigt.
//
// Warum Data-URL statt Dateipfad? Der Brief wird als reines HTML an den
// PDF-Renderer (Electron) übergeben; relative Bildpfade lassen sich dort
// nicht auflösen. Inline-Base64 funktioniert überall (wie beim Logo).
//
// Bild eintragen: kleines, freigestelltes Porträt (ca. 300×360 px, JPG),
// in eine Data-URL umwandeln (z.B. https://www.base64-image.de) und unten
// beim passenden Arzt einsetzen. Nur mit Einwilligung des Arztes verwenden.
export const DOCTOR_PHOTOS: Record<string, string> = {
  Artemiev:   '',
  Menke:      '',
  Malinina:   '',
  Tschopp:    '',
  Trachsler:  '',
  Kirr:       '',
  Papazoglou: '',
}

/** Liefert die Foto-Data-URL für einen Arzt-Nachnamen, oder '' wenn keines. */
export function doctorPhoto(doctor: string | null | undefined): string {
  if (!doctor) return ''
  return DOCTOR_PHOTOS[doctor] || ''
}
