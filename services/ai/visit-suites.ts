// services/ai/visit-suites.ts
// « MemorIA a compris votre visite » — détection de SUITES depuis le TEXTE.
//
// À partir des notes et des transcriptions de mémos vocaux, MemorIA PROPOSE des
// suites concrètes : actions à réaliser, réserves, points à surveiller. Elle ne
// crée RIEN — l'humain valide (Créer / Modifier / Ignorer). Même doctrine que le
// résumé : une seule IA, à la fin, sur du TEXTE (jamais d'images), GATÉE, et un
// repli VIDE (pas d'invention) si l'IA est absente ou échoue. Rien n'est jamais
// matérialisé sans validation humaine.

import { getAIProvider } from './factory'
import { withAITracking } from './tracking'

export type SuiteKind = 'action' | 'reserve' | 'surveiller'

export interface DetectSuitesInput {
  siteName: string
  /** Textes source (transcription de vocal, note) avec leur id de capture. */
  items: Array<{ id: string; text: string }>
  userId: string | null
}

export interface DetectedSuite {
  sourceId: string
  kind: SuiteKind
  text: string
}

const SYSTEM = `Tu es MemorIA. Tu lis des NOTES et des TRANSCRIPTIONS de mémos vocaux pris pendant une visite de chantier, et tu en extrais des SUITES CONCRÈTES à proposer au conducteur.

Trois types :
- "action" : quelque chose À FAIRE (reprise, contrôle, vérification, relance…). Formule à l'infinitif, courte.
- "reserve" : un défaut / une non-conformité à consigner (à lever plus tard).
- "surveiller" : un point de vigilance à revoir aux prochaines visites, sans action immédiate.

Règles STRICTES :
- N'INVENTE RIEN. Chaque suite doit venir EXPLICITEMENT du texte. Aucun fait, lieu ou chiffre absent des données.
- Ignore le bavardage, les constats sans suite, les descriptions neutres.
- Une même source peut donner 0, 1 ou plusieurs suites.
- Réponds UNIQUEMENT par un tableau JSON, sans texte autour :
[{"sourceId":"<id fourni>","kind":"action|reserve|surveiller","text":"formulation courte"}]
- Si rien de concret : []`

/** GATE : au moins un texte un peu consistant, sinon aucun appel. */
function worthCalling(items: DetectSuitesInput['items']): boolean {
  return items.some((it) => it.text.trim().length >= 8)
}

function parseSuites(raw: string, knownIds: Set<string>): DetectedSuite[] {
  // Le modèle peut encadrer de ```json … ``` ou ajouter du texte : on isole le
  // premier tableau JSON.
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []
  let arr: unknown
  try {
    arr = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: DetectedSuite[] = []
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const sourceId = typeof r.sourceId === 'string' ? r.sourceId : ''
    const kind = r.kind
    const text = typeof r.text === 'string' ? r.text.trim() : ''
    if (!knownIds.has(sourceId)) continue
    if (kind !== 'action' && kind !== 'reserve' && kind !== 'surveiller') continue
    if (!text || text.length > 300) continue
    out.push({ sourceId, kind, text })
    if (out.length >= 15) break // borne dure
  }
  return out
}

/**
 * Détecte les suites depuis le texte. Repli VIDE (jamais d'invention) : pas d'IA
 * configurée, gate non franchie, ou échec → aucune proposition texte (les suites
 * TAGUÉES, elles, restent proposées par ailleurs). Un seul appel `light`.
 */
export async function detectVisitSuites(input: DetectSuitesInput): Promise<DetectedSuite[]> {
  if (input.items.length === 0 || !worthCalling(input.items)) return []
  const provider = getAIProvider()
  if (provider.name === 'mock') return []

  const knownIds = new Set(input.items.map((it) => it.id))
  const userMessage = [
    `Chantier : ${input.siteName}`,
    '',
    'Éléments captés (id — texte) :',
    ...input.items.map((it) => `${it.id} — ${it.text}`),
    '',
    'Extrais les suites (JSON).',
  ].join('\n')

  try {
    return await withAITracking('visit_suites', input.userId, async () => {
      const out = await provider.complete({ systemPrompt: SYSTEM, userMessage, modelTier: 'light', maxOutputTokens: 600 })
      const suites = parseSuites(out.text ?? '', knownIds)
      return { result: suites, tokens: out.tokens, model: out.model, provider: provider.name, durationMs: out.durationMs }
    })
  } catch {
    return []
  }
}
