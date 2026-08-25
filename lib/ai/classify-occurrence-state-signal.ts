// Classification sémantique stateless d'une occurrence d'objet métier (action/réserve/
// échéance) en signal d'évolution d'état — P1-C2B.4 H2-B.2.
//
// Contrat validé en dry-run (H2-A, scripts/p1c2b4i-h2a-live-mechanism-dryrun.ts) :
//   - Un seul appel par occurrence, SANS connaître l'historique de l'objet (stateless).
//   - Le texte fourni est celui de L'OCCURRENCE ELLE-MÊME, jamais le canonical_subject entier
//     ni la trajectoire du CBO — même doctrine que le carve-out qui avait produit les faux
//     CONTRADICTED (cf. mémoire canonical-business-object-doctrine).
//   - Aucune conclusion à partir du silence : NO_STATE_SIGNAL est une réponse valide et
//     attendue, jamais un défaut de panne.
//
// Doctrine d'échec (H2-B, mandat Vincent 2026-08-25) : une panne technique ne devient JAMAIS
// silencieusement NO_STATE_SIGNAL — elle retourne un diagnostic typé (error_code aligné sur le
// CHECK constraint de object_state_occurrence_signal, migration 349). Ne lève jamais, ne bloque
// jamais l'appelant — même contrat que lib/ai/qualify-link-candidates.ts.

import { z } from 'zod'

export const SIGNAL_VALUES = ['OPENED', 'STILL_OPEN', 'PROGRESS', 'COMPLETED', 'REOPENED', 'NO_STATE_SIGNAL'] as const
export type ObjectStateSignal = (typeof SIGNAL_VALUES)[number]

// Aligné sur le CHECK constraint error_code de supabase/migrations/349_object_state_occurrence_signal.sql.
export const OCCURRENCE_SIGNAL_ERROR_CODES = [
  'NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'PROVIDER_ERROR',
  'INVALID_RESPONSE', 'SCHEMA_VALIDATION_ERROR', 'EMPTY_RESPONSE',
  'CONFIG_ERROR', 'UNKNOWN_ERROR',
] as const
export type OccurrenceSignalErrorCode = (typeof OCCURRENCE_SIGNAL_ERROR_CODES)[number]

export type ClassifyOccurrenceResult =
  | { ok: true; signal: ObjectStateSignal; confidence: number; evidenceText: string }
  | { ok: false; errorCode: OccurrenceSignalErrorCode; errorDetail: string }

const GEMINI_SCHEMA = {
  type: 'object',
  properties: {
    signal:        { type: 'string', enum: [...SIGNAL_VALUES] },
    confidence:    { type: 'number' },
    evidence_text: { type: 'string' },
  },
  required: ['signal', 'confidence', 'evidence_text'],
}
const ResultSchema = z.object({
  signal: z.enum(SIGNAL_VALUES),
  confidence: z.number().min(0).max(1),
  evidence_text: z.string(),
})

// Prompt validé en dry-run H2-A round 2 (verbatim) — ne pas reformuler sans repasser par
// une recalibration explicite : la distinction périodique/procédurale vs anomalie explicite
// a été calibrée contre 118 occurrences réelles + cas de généralisation.
const SYSTEM_PROMPT = `Tu analyses UNE SEULE phrase extraite d'un compte-rendu de chantier BTP (procès-verbal de réunion, PV).
Ta tâche : dire ce que CETTE phrase, isolément, affirme sur l'état d'avancement de l'objet dont elle parle
(une action, une réserve/non-conformité, ou une échéance).

Tu ne connais PAS l'historique de cet objet. Tu ne dois JAMAIS supposer ce qui s'est passé avant ou après
cette phrase. Si la phrase ne permet pas de savoir si c'est la première mention ou une répétition, ne le suppose pas.

DISTINCTION CENTRALE — l'existence d'une obligation n'est pas un signal d'évolution de cette obligation :
une consigne périodique, récurrente ou procédurale (réunion planifiée, transmission attendue à échéance
régulière, présentation mensuelle, relevé habituel, obligation contractuelle générique...) qui se contente
de RAPPELER ou DÉCRIRE l'obligation elle-même n'affirme rien sur un état. Elle dit seulement qu'un cycle
habituel existe — pas qu'un objet métier vient de s'ouvrir, de progresser ou de se clore. Ne sors de
NO_STATE_SIGNAL pour une telle phrase QUE si elle affirme explicitement une anomalie ou un état SUR CETTE
occurrence précise du cycle (retard constaté, non transmis, toujours attendu, ne s'est pas tenu, etc.).
Exemples : "Présentation des situations du mois en cours avant le 25" -> NO_STATE_SIGNAL (rappel de
l'obligation, aucune anomalie constatée). "La situation de juillet n'a toujours pas été transmise" ->
signal d'état explicite, à classer normalement. "Prochaine réunion le 12 septembre" -> NO_STATE_SIGNAL.
"La réunion prévue le 12 septembre n'a pas eu lieu" -> signal d'état explicite.

Choisis EXACTEMENT une valeur parmi :
- OPENED         : la phrase signale ou redemande quelque chose de non fait, sans indiquer explicitement
                    que ce n'est pas la première fois (demande, non-conformité constatée, "à faire/à prévoir/à transmettre").
- STILL_OPEN      : la phrase affirme EXPLICITEMENT la persistance/continuation d'un état non résolu
                    ("toujours en attente", "encore non conforme", "reste à faire malgré...", "non résolu").
- PROGRESS        : la phrase signale un avancement partiel, un travail engagé mais non terminé.
- COMPLETED       : la phrase affirme que quelque chose a été fait/réalisé/clôturé/soldé/levé.
- REOPENED        : la phrase affirme EXPLICITEMENT qu'un point donné pour clos/résolu redevient un problème
                    ("à nouveau", "réapparu", "remis en cause", "persiste malgré la reprise").
- NO_STATE_SIGNAL : la phrase ne contient AUCUNE affirmation exploitable sur l'état d'avancement de l'objet
                    (mention factuelle, information neutre, planification, rappel procédural ou périodique
                    sans anomalie constatée, absence d'indice réel). C'est une réponse NORMALE et attendue,
                    pas un échec — ne force jamais une autre catégorie faute de mieux.

Règle absolue : si le texte ne décrit pas EXPLICITEMENT une ouverture, une persistance, une progression,
une réalisation ou une réouverture DE CET OBJET PRÉCIS, réponds NO_STATE_SIGNAL. Ne conclus JAMAIS à partir
du silence, d'une formulation neutre, d'une information de planification, ou d'un rappel procédural/périodique
générique. "RAS", "pour information", "prochaine réunion le...", une consigne périodique sans anomalie
constatée : ce sont des NO_STATE_SIGNAL, pas des signaux à interpréter par optimisme.

evidence_text : recopie l'extrait exact (≤ 200 caractères) du texte fourni qui justifie ta réponse.
Si NO_STATE_SIGNAL, evidence_text = "".

Réponds uniquement en JSON.`

const TIMEOUT_MS = 20_000

function truncateDetail(msg: string): string {
  return msg.length > 500 ? msg.slice(0, 500) : msg
}

function fail(errorCode: OccurrenceSignalErrorCode, errorDetail: string): ClassifyOccurrenceResult {
  return { ok: false, errorCode, errorDetail: truncateDetail(errorDetail) }
}

/**
 * Classifie UNE occurrence (texte de l'entité elle-même) en signal d'évolution d'état.
 * Ne lève jamais — toute panne retourne un diagnostic typé (jamais un repli silencieux
 * sur NO_STATE_SIGNAL, ce qui déguiserait une panne technique en conclusion sémantique).
 */
export async function classifyOccurrenceStateSignal(text: string): Promise<ClassifyOccurrenceResult> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) return fail('CONFIG_ERROR', 'GOOGLE_GENAI_API_KEY manquante')
  if (!text.trim()) return fail('CONFIG_ERROR', 'Texte vide fourni au classificateur')

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.0,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }

    let resp: Response
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal },
      )
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return fail('TIMEOUT', `Timeout après ${TIMEOUT_MS}ms`)
      return fail('NETWORK_ERROR', e instanceof Error ? e.message : String(e))
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      if (resp.status === 429) return fail('RATE_LIMIT', `HTTP 429: ${text}`)
      return fail('PROVIDER_ERROR', `HTTP ${resp.status}: ${text}`)
    }

    const json = await resp.json()
    const rtext = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!rtext) return fail('EMPTY_RESPONSE', 'Réponse Gemini sans texte exploitable')

    let raw: unknown
    try {
      raw = JSON.parse(rtext)
    } catch (e) {
      return fail('INVALID_RESPONSE', e instanceof Error ? e.message : String(e))
    }

    const parsed = ResultSchema.safeParse(raw)
    if (!parsed.success) return fail('SCHEMA_VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'schéma invalide')

    return {
      ok: true,
      signal: parsed.data.signal,
      confidence: parsed.data.confidence,
      evidenceText: parsed.data.evidence_text,
    }
  } catch (e) {
    return fail('UNKNOWN_ERROR', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}
