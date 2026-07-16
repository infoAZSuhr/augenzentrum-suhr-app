// KI-Brieftext-Formulierung via Firebase AI Logic (Vertex AI, läuft über die
// bestehende Blaze-Abrechnung — Kosten pro Brief im Sub-Rappen-Bereich).
// DATENSCHUTZ: Es werden KEINE Patientendaten an die API geschickt — nur der anonyme
// Anliegen-Text. Konkrete Angaben (Namen, Daten) kommen als [Platzhalter] zurück und
// werden erst lokal in der App ergänzt.
import { getAI, getGenerativeModel, VertexAIBackend } from 'firebase/ai'
import { app } from './firebase'

let _model: ReturnType<typeof getGenerativeModel> | null = null

function model() {
  if (!_model) {
    const ai = getAI(app, { backend: new VertexAIBackend('europe-west1') })
    _model = getGenerativeModel(ai, {
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    })
  }
  return _model
}

export type BriefEntwurf = { betreff: string; text: string }

const SYSTEM_ANWEISUNG = `Du formulierst Brieftexte für das Augenzentrum Suhr, eine augenärztliche Praxis in der Schweiz (Tel. 062 842 18 46, info@augenzentrum-suhr.ch).

Regeln:
- Sprache: Deutsch (Schweiz), also "ss" statt "ß".
- Ton: professionell, höflich, warm — wie von einer erfahrenen medizinischen Praxisassistentin geschrieben.
- KEINE Anrede (z.B. "Sehr geehrte...") und KEINE Grussformel am Ende — beides wird automatisch ergänzt. Nur der eigentliche Fliesstext.
- Kurz und klar: 1–3 Absätze, Absätze durch eine Leerzeile getrennt.
- Verwende NIEMALS erfundene konkrete Angaben. Wo eine konkrete Angabe nötig ist (Datum, Uhrzeit, Name, Dokument), setze einen Platzhalter in eckigen Klammern, z.B. [Datum], [Uhrzeit], [Name].
- Antworte ausschliesslich als JSON-Objekt: {"betreff": "...", "text": "..."}`

/**
 * Formuliert aus einem stichwortartigen Anliegen einen fertigen Brieftext.
 * Wirft bei Netzwerk-/API-Fehlern — Aufrufer zeigt Toast.
 */
export async function generateBriefText(anliegen: string, empfaenger: string): Promise<BriefEntwurf> {
  const prompt = `${SYSTEM_ANWEISUNG}

Empfänger des Briefs: ${empfaenger}
Anliegen (Stichworte der MPA): ${anliegen.trim()}`

  const result = await model().generateContent(prompt)
  const raw = result.response.text()
  // JSON ggf. aus Markdown-Codeblock schälen
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Unerwartete KI-Antwort')
  const parsed = JSON.parse(match[0]) as Partial<BriefEntwurf>
  if (!parsed.text?.trim()) throw new Error('KI-Antwort ohne Text')
  return { betreff: (parsed.betreff || '').trim(), text: parsed.text.trim() }
}

// KI-Zusammenfassung eines Arztberichts. DATENSCHUTZ: Es wird NUR der Text
// zusammengefasst, den die MPA bewusst hier einfügt (z.B. ein Ausschnitt aus
// einem Bericht) — anders als ein automatischer PDF-Upload entscheidet die
// MPA selbst, was sie einfügt.
const SYSTEM_ANWEISUNG_BERICHT = `Du fasst medizinische Arztberichte für eine augenärztliche Praxis in der Schweiz (Augenzentrum Suhr) für die MPA (medizinische Praxisassistentin) zusammen.

Regeln:
- Sprache: Deutsch (Schweiz), also "ss" statt "ß".
- Fasse NUR das medizinisch Wesentliche zusammen: Diagnose(n), durchgeführte Behandlung/OP, Befund, weiteres Vorgehen/Empfehlung.
- Erfinde NICHTS — wenn eine Information im Text fehlt, lass den entsprechenden Punkt einfach weg.
- Kurz: maximal 5 Stichpunkte, je ein Satz.
- Antworte ausschliesslich als JSON-Objekt: {"punkte": ["...", "..."]}`

/**
 * Fasst einen (von der MPA eingefügten) Berichtstext in Stichpunkten zusammen.
 * Wirft bei Netzwerk-/API-Fehlern oder leerem Text — Aufrufer zeigt Toast.
 */
export async function summarizeBericht(text: string): Promise<string[]> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Kein Text zum Zusammenfassen')

  const prompt = `${SYSTEM_ANWEISUNG_BERICHT}

Berichtstext:
${trimmed}`

  const result = await model().generateContent(prompt)
  const raw = result.response.text()
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Unerwartete KI-Antwort')
  const parsed = JSON.parse(match[0]) as { punkte?: string[] }
  if (!parsed.punkte?.length) throw new Error('KI-Antwort ohne Stichpunkte')
  return parsed.punkte.map(p => p.trim()).filter(Boolean)
}
