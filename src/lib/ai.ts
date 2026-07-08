// KI-Brieftext-Formulierung via Firebase AI Logic (Gemini Developer API, Gratis-Kontingent).
// DATENSCHUTZ: Es werden KEINE Patientendaten an die API geschickt — nur der anonyme
// Anliegen-Text. Konkrete Angaben (Namen, Daten) kommen als [Platzhalter] zurück und
// werden erst lokal in der App ergänzt.
import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai'
import { app } from './firebase'

let _model: ReturnType<typeof getGenerativeModel> | null = null

function model() {
  if (!_model) {
    const ai = getAI(app, { backend: new GoogleAIBackend() })
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
