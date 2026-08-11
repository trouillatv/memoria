/**
 * Classificateur d'évolution V2 — shadow mode uniquement.
 *
 * Architecture : preuves → état consolidé T → comparaison T₁/T₂ → verdict
 * Ne jamais comparer deux occurrences directement.
 *
 * Feature flag : EVOLUTION_V2_ENABLED_SITES (CSV de siteIds).
 * Par défaut restreint à PETRO (corpus de développement).
 * La généralisation attend un out-of-sample test sur un deuxième chantier.
 */

import { z } from 'zod'
import { getAIProvider } from '@/services/ai/factory'

// ── Feature flag ───────────────────────────────────────────────────────────────

const PETRO_SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'

export function isEvolutionV2Enabled(siteId: string): boolean {
  const env = process.env.EVOLUTION_V2_ENABLED_SITES ?? ''
  const sites = env ? env.split(',').map((s) => s.trim()) : [PETRO_SITE_ID]
  return sites.includes(siteId)
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type EvolutionV2Verdict = 'meaningful_change' | 'remention' | 'ambiguous'
export type EvolutionV2Pattern = 'status_transition' | 'scope_change' | 'operationalization' | 'new_fact'

export interface ConsolidatedState {
  /** État métier synthétique de l'événement — entrée pour la classification. */
  state: string
  /** true si une formulation semble être du bruit d'extraction (recycled, décontextualisée). */
  noiseDetected: boolean
  rawLabels: string[]
  date: string
  sourceKind: string
}

export interface EvolutionV2Result {
  verdict: EvolutionV2Verdict
  /** null si verdict = remention ou ambiguous. */
  pattern: EvolutionV2Pattern | null
  /** Citation des états sources justifiant la décision. */
  justification: string
  /** 0–1. Confidence faible ≠ ambiguous : c'est le modèle qui hésite, pas la situation. */
  confidence: number
  stateT1: ConsolidatedState
  stateT2: ConsolidatedState
}

export interface V2SubjectResult {
  canonicalSubjectId: string
  subjectLabel: string
  /** Une entrée par paire consécutive d'événements (events[i] → events[i+1]). */
  pairs: Array<{
    stateT1: ConsolidatedState
    stateT2: ConsolidatedState
    result: EvolutionV2Result | null
  }>
}

// ── Zod schemas ────────────────────────────────────────────────────────────────

const ConsolidatedStateOutputSchema = z.object({
  state: z.string().max(400),
  noiseDetected: z.boolean(),
})

const CONSOLIDATION_GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    state: { type: 'STRING' },
    noiseDetected: { type: 'BOOLEAN' },
  },
  required: ['state', 'noiseDetected'],
}

const ClassificationOutputSchema = z.object({
  verdict: z.enum(['meaningful_change', 'remention', 'ambiguous']),
  // pattern optionnel — Gemini peut l'omettre si verdict != meaningful_change
  pattern: z.enum(['status_transition', 'scope_change', 'operationalization', 'new_fact']).nullable().optional(),
  justification: z.string().max(600),
  confidence: z.number().min(0).max(1),
})

const CLASSIFICATION_GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['meaningful_change', 'remention', 'ambiguous'] },
    pattern: { type: 'STRING', enum: ['status_transition', 'scope_change', 'operationalization', 'new_fact'] },
    justification: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['verdict', 'justification', 'confidence'],
}

// ── Étape 1 : Consolidation ────────────────────────────────────────────────────

const CONSOLIDATION_SYSTEM = `Tu es un expert en suivi de chantier.
Tâche : synthétiser plusieurs formulations d'un même sujet lors d'une même visite en un état métier unique et concis.

Règles :
- Les formulations proviennent de la même visite (même date). Elles décrivent le même fait sous plusieurs angles ou niveaux de détail.
- Synthétise en 1-2 phrases maximum capturant l'essentiel de la situation du sujet à cette date.
- Ignore les formulations qui semblent être du bruit : termes trop génériques, ou formulation qui semble recycler un état antérieur incohérent avec les autres formulations de la même visite.
- Si une telle formulation parasite est détectée, indique noiseDetected:true.
- Réponds exclusivement en JSON selon le schéma fourni.`

export async function consolidateSubjectState(
  subjectLabel: string,
  labels: string[],
  date: string,
  sourceKind: string,
): Promise<ConsolidatedState> {
  if (labels.length === 1) {
    return { state: labels[0], noiseDetected: false, rawLabels: labels, date, sourceKind }
  }

  const provider = getAIProvider()
  const userMessage = `Sujet : "${subjectLabel}"
Date de visite : ${date}
Source : ${sourceKind === 'field_visit' ? 'Visite terrain' : 'Réunion'}

Formulations (${labels.length}) :
${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`

  try {
    const out = await provider.complete({
      systemPrompt: CONSOLIDATION_SYSTEM,
      userMessage,
      responseSchema: ConsolidatedStateOutputSchema,
      geminiSchema: CONSOLIDATION_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: 300,
    })

    const parsed = ConsolidatedStateOutputSchema.safeParse(out.parsed)
    if (!parsed.success) {
      return { state: labels[0], noiseDetected: false, rawLabels: labels, date, sourceKind }
    }
    return { ...parsed.data, rawLabels: labels, date, sourceKind }
  } catch {
    return { state: labels[0], noiseDetected: false, rawLabels: labels, date, sourceKind }
  }
}

// ── Étape 2 : Classification ───────────────────────────────────────────────────

const CLASSIFICATION_SYSTEM = `Tu es un expert en suivi de chantier.
Tâche : déterminer si un sujet a subi une évolution significative entre deux visites.

Définitions :
- meaningful_change : le statut opérationnel, le périmètre, la réalisation concrète ou un fait nouveau a changé. Ex : "intervention prévue" → "lancement acté".
- remention : reformulation ou reconfirmation du même état sans changement métier réel. Plus de mots ou de formulations différentes ne constitue PAS une évolution.
- ambiguous : les états disponibles ne permettent pas de conclure avec certitude.

Règles impératives :
- La différence lexicale seule n'est JAMAIS une preuve d'évolution.
- "ambiguous" est une réponse valide — ne force pas une décision binaire si les preuves sont insuffisantes.
- Cite toujours les états T1 et T2 dans la justification pour expliquer la décision.

Patterns d'évolution (uniquement si meaningful_change) :
- status_transition : changement de statut opérationnel (prévu → lancé, attendu → réalisé, etc.)
- scope_change : le périmètre est redéfini (ajout, retrait, remplacement d'éléments)
- operationalization : passage d'un besoin ou d'un plan vers une réalisation concrète observable
- new_fact : apparition d'un fait nouveau non présent en T1 (retard, incident, décision, contrainte)

Réponds exclusivement en JSON selon le schéma fourni.`

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function formatSource(s: string): string {
  return s === 'field_visit' ? 'Visite terrain' : 'Réunion'
}

export async function classifyEvolution(
  stateT1: ConsolidatedState,
  stateT2: ConsolidatedState,
  subjectLabel: string,
): Promise<EvolutionV2Result | null> {
  const provider = getAIProvider()

  const userMessage = `Sujet : "${subjectLabel}"

État à T1 — ${formatDate(stateT1.date)} · ${formatSource(stateT1.sourceKind)} :
"${stateT1.state}"

État à T2 — ${formatDate(stateT2.date)} · ${formatSource(stateT2.sourceKind)} :
"${stateT2.state}"`

  try {
    const out = await provider.complete({
      systemPrompt: CLASSIFICATION_SYSTEM,
      userMessage,
      responseSchema: ClassificationOutputSchema,
      geminiSchema: CLASSIFICATION_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: 400,
    })

    const parsed = ClassificationOutputSchema.safeParse(out.parsed)
    if (!parsed.success) return null

    return {
      verdict: parsed.data.verdict,
      pattern: parsed.data.pattern ?? null,
      justification: parsed.data.justification,
      confidence: parsed.data.confidence,
      stateT1,
      stateT2,
    }
  } catch {
    return null
  }
}

// ── Orchestrateur par sujet ────────────────────────────────────────────────────

export async function classifySubjectEvolutionV2(
  subject: {
    canonicalSubjectId: string
    label: string
    events: Array<{ date: string; sourceKind: 'field_visit' | 'meeting'; labels: string[] }>
  },
): Promise<V2SubjectResult> {
  const consolidatedEvents = await Promise.all(
    subject.events.map((ev) =>
      consolidateSubjectState(subject.label, ev.labels, ev.date, ev.sourceKind)
    )
  )

  const pairs: V2SubjectResult['pairs'] = []
  for (let i = 0; i < consolidatedEvents.length - 1; i++) {
    const t1 = consolidatedEvents[i]
    const t2 = consolidatedEvents[i + 1]
    const result = await classifyEvolution(t1, t2, subject.label)
    pairs.push({ stateT1: t1, stateT2: t2, result })
  }

  return {
    canonicalSubjectId: subject.canonicalSubjectId,
    subjectLabel: subject.label,
    pairs,
  }
}
