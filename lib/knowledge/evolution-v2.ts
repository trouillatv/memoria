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

export function isEvolutionV2Enabled(siteId: string): boolean {
  const env = process.env.EVOLUTION_V2_ENABLED_SITES ?? ''
  if (!env) return false
  return env.split(',').map((s) => s.trim()).includes(siteId)
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type EvolutionV2Verdict = 'meaningful_change' | 'remention' | 'ambiguous'
export type EvolutionV2Pattern = 'status_transition' | 'scope_change' | 'operationalization' | 'new_fact'

export type OperationalState =
  | 'planned'       // prévu, à programmer, à faire (aucun début d'exécution)
  | 'expected'      // attendu, demandé, doit arriver (engagement sans preuve d'exécution)
  | 'communicated'  // un acte de communication explicite a eu lieu (code transmis, info diffusée)
  | 'started'       // exécution clairement commencée — verbe d'action au présent ou passé composé
  | 'implemented'   // réalisé, terminé — signal factuel explicite de complétion
  | 'verified'      // contrôlé, validé, constaté comme conforme
  | 'unknown'       // ne peut pas être déterminé depuis les formulations disponibles

export interface ConsolidatedState {
  /** Résumé factuel en 1-2 phrases — entrée principale pour la classification. */
  summary: string
  /** Stade opérationnel. Ne pas utiliser comme fait fort si operationalStateEvidence est vide. */
  operationalState: OperationalState
  /**
   * Citation textuelle verbatim depuis les formulations justifiant operationalState.
   * Vide si aucune formulation ne prouve clairement le stade — dans ce cas operationalState='unknown'.
   */
  operationalStateEvidence: string
  /**
   * Faits nouveaux discrets identifiés (retards, décisions, incidents, réalisations concrètes).
   * Chaque entrée = un fait atomique, non reformulation d'un état précédent connu.
   */
  newFacts: string[]
  /** Acteurs ou entreprises explicitement nommés dans les formulations. */
  actors: string[]
  /**
   * Confiance dans la qualité de la consolidation (0–1).
   * Basse si les formulations sont contradictoires, recyclées ou trop génériques.
   */
  stateConfidence: number
  /** true si une formulation parasite a été détectée et ignorée. */
  noiseDetected: boolean
  /**
   * true si le LLM a échoué ou produit un schéma invalide — summary = labels[0].
   * Un fallback ≠ consolidation correcte : à surveiller dans l'évaluation.
   */
  fallbackUsed: boolean
  rawLabels: string[]
  date: string
  sourceKind: string
}

export interface EvolutionV2Result {
  verdict: EvolutionV2Verdict
  /** null si verdict = remention ou ambiguous. */
  pattern: EvolutionV2Pattern | null
  /** Justification citant les éléments sources ayant guidé la décision. */
  justification: string
  /** 0–1. Confiance faible ≠ ambiguous : c'est le modèle qui hésite, pas la situation. */
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

const OPERATIONAL_STATE_VALUES = ['planned', 'expected', 'communicated', 'started', 'implemented', 'verified', 'unknown'] as const

// newFacts et actors : chaînes séparées par " | " côté Gemini → tableau côté Zod.
// Évite le type ARRAY dans le schéma Gemini qui causait des troncatures JSON.
function splitPipe(v: string | null | undefined): string[] {
  if (!v) return []
  return v.split('|').map((s) => s.trim()).filter(Boolean)
}

const ConsolidatedStateOutputSchema = z.object({
  summary: z.string().max(500),
  operationalState: z.enum(OPERATIONAL_STATE_VALUES),
  operationalStateEvidence: z.string().nullable().optional().transform((v) => v ?? ''),
  newFacts: z.string().nullable().optional().transform(splitPipe),
  actors: z.string().nullable().optional().transform(splitPipe),
  stateConfidence: z.number().min(0).max(1).nullable().optional().transform((v) => v ?? 0.5),
  noiseDetected: z.boolean(),
})

const CONSOLIDATION_GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    operationalState: { type: 'STRING', enum: OPERATIONAL_STATE_VALUES },
    operationalStateEvidence: { type: 'STRING' },
    newFacts: { type: 'STRING' },
    actors: { type: 'STRING' },
    stateConfidence: { type: 'NUMBER' },
    noiseDetected: { type: 'BOOLEAN' },
  },
  required: ['summary', 'operationalState', 'operationalStateEvidence', 'newFacts', 'actors', 'stateConfidence', 'noiseDetected'],
}

const ClassificationOutputSchema = z.object({
  verdict: z.enum(['meaningful_change', 'remention', 'ambiguous']),
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

const CONSOLIDATION_SYSTEM = `Tu es un expert en suivi de chantier de construction.

Tâche : à partir de plusieurs formulations d'un même sujet lors d'une visite, produire un état factuel structuré.

─── Champ "summary" ───
Résumé factuel en 1-2 phrases. Capture l'essentiel de la situation à cette date.
Ne pas inventer, ne pas extrapoler au-delà de ce que les formulations disent explicitement.

─── Champ "operationalState" ───
Stade opérationnel. Choisir le stade le plus avancé CLAIREMENT PROUVÉ par le texte :
- planned : mentionné comme "à faire", "prévu", "à programmer" — aucune exécution constatée
- expected : attendu, demandé, "doit être fait" — engagement pris, pas d'exécution prouvée
- communicated : un acte de communication concret a eu lieu ("le code a été transmis", "présenté lors de l'accueil")
- started : exécution manifestement commencée — verbe en cours ou passé composé d'action continue
- implemented : complétion explicite — "a été réalisé", "est terminé", "est en place et fonctionnel"
- verified : contrôlé, inspecté, validé comme conforme
- unknown : aucun stade ne peut être établi depuis les formulations

RÈGLES CRITIQUES sur operationalState :
1. "Intervention X pour faire Y" → expected (ce que X DOIT faire, pas la preuve qu'il l'a fait)
2. "X va vérifier", "X vérifieront" → planned ou expected — jamais started ni implemented
3. "Présentation de Y" → communicated (l'acte de présentation a eu lieu)
4. "Y a été lancé", "Y est lancé" → started (lancement confirmé)
5. "Y a été réalisé/effectué/installé" → implemented
6. Un item action récurrent ("Diffuser le planning") n'est pas une preuve d'exécution

─── Champ "operationalStateEvidence" ───
Citation verbatim (ou paraphrase très courte) de la formulation qui prouve operationalState.
Si aucune formulation ne prouve clairement le stade : laisser vide et mettre operationalState="unknown".

─── Champ "newFacts" ───
Faits nouveaux discrets séparés par " | " : retards constatés, décisions prises, incidents, réalisations concrètes, contraintes découvertes.
Chaque fait = une information qui n'était PAS déjà implicite dans le problème central du sujet.
Ne pas inclure : reformulations de tâches récurrentes, items action génériques, redites du problème principal.
Si aucun fait nouveau : laisser vide ("").

─── Champ "actors" ───
Noms d'entreprises ou de personnes explicitement mentionnés, séparés par " | ". Vide si aucun.

─── Champ "stateConfidence" ───
0.0 = formulations très génériques ou contradictoires, consolidation fragile
0.5 = formulations cohérentes mais peu précises
1.0 = formulations explicites, sans ambiguïté

─── Champ "noiseDetected" ───
true si une formulation semble recycler un état antérieur incohérent avec les autres formulations de cette visite.

Réponds exclusivement en JSON selon le schéma fourni.`

function makeFallback(labels: string[], date: string, sourceKind: string): ConsolidatedState {
  return {
    summary: labels[0],
    operationalState: 'unknown',
    operationalStateEvidence: '',
    newFacts: [],
    actors: [],
    stateConfidence: 0,
    noiseDetected: false,
    fallbackUsed: true,
    rawLabels: labels,
    date,
    sourceKind,
  }
}

export async function consolidateSubjectState(
  subjectLabel: string,
  labels: string[],
  date: string,
  sourceKind: string,
): Promise<ConsolidatedState> {
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
      maxOutputTokens: 800,
    })

    const parsed = ConsolidatedStateOutputSchema.safeParse(out.parsed)
    if (!parsed.success) return makeFallback(labels, date, sourceKind)

    return { ...parsed.data, fallbackUsed: false, rawLabels: labels, date, sourceKind }
  } catch {
    return makeFallback(labels, date, sourceKind)
  }
}

// ── Étape 2 : Classification ───────────────────────────────────────────────────

const CLASSIFICATION_SYSTEM = `Tu es un expert en suivi de chantier.
Tâche : déterminer si un sujet a subi une évolution significative entre deux visites.

Définitions :
- meaningful_change : un fait métier nouveau, un changement de stade opérationnel prouvé, ou une modification de périmètre. Ex : "intervention attendue" → "lancement acté".
- remention : reformulation ou reconfirmation du même état sans changement métier réel. Davantage de mots ≠ évolution.
- ambiguous : les éléments disponibles ne permettent pas de conclure avec certitude.

Hiérarchie des signaux (du plus fort au plus faible) :
1. "Faits nouveaux en T2" — si T2 contient des faits absents de T1 (retard constaté, décision prise, incident, réalisation nouvelle), c'est presque toujours meaningful_change(new_fact). Vérifier qu'ils ne reformulent pas un élément de T1.
2. "Stade opérationnel avec preuve" — si operationalState est prouvé (evidence non vide) et progresse clairement, c'est meaningful_change. Si evidence est vide ou stateConfidence < 0.4, ne pas utiliser operationalState comme signal fort.
3. "Régression opérationnelle" — si T2 est moins avancé que T1 sans explication dans les faits nouveaux : ambiguous (contradiction temporelle probable).
4. "Contenu textuel identique ou équivalent" — remention, quelle que soit la formulation.

Règle absolue sur la réalisation :
Un passage à "implemented" ou "verified" ne qualifie comme meaningful_change que si T2 contient un signal factuel explicite ("a été réalisé", "est terminé", "constaté conforme"). Une formulation au futur ("sera", "vont", "se fera") NE PROUVE PAS une réalisation.

Règle sur operationalState "unknown" :
Ne pas comparer deux stades si l'un des deux est "unknown". Baser la décision uniquement sur les résumés et les faits nouveaux.

Patterns (uniquement si meaningful_change) :
- status_transition : changement de stade opérationnel (prévu → lancé, etc.)
- scope_change : périmètre redéfini
- operationalization : passage d'un besoin/plan vers une réalisation observable
- new_fact : fait nouveau non présent en T1

Cite toujours les éléments de T1 et T2 dans la justification. "ambiguous" est une réponse valide.
Réponds exclusivement en JSON selon le schéma fourni.`

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
function formatSource(s: string): string {
  return s === 'field_visit' ? 'Visite terrain' : 'Réunion'
}
function formatEvidence(state: ConsolidatedState): string {
  if (state.operationalState === 'unknown' || !state.operationalStateEvidence) return 'non prouvé'
  return `"${state.operationalStateEvidence}"`
}
function formatList(items: string[]): string {
  if (items.length === 0) return 'aucun'
  return items.map((f) => `  - ${f}`).join('\n')
}

export async function classifyEvolution(
  stateT1: ConsolidatedState,
  stateT2: ConsolidatedState,
  subjectLabel: string,
): Promise<EvolutionV2Result | null> {
  const provider = getAIProvider()

  const hasNewFacts = stateT2.newFacts.length > 0
  const newFactsHint = hasNewFacts
    ? `\n⚠ T2 contient des faits nouveaux — signal fort de meaningful_change(new_fact) si absents de T1.`
    : ''

  const userMessage = `Sujet : "${subjectLabel}"

T1 — ${formatDate(stateT1.date)} · ${formatSource(stateT1.sourceKind)} (confiance consolidation : ${stateT1.stateConfidence.toFixed(1)}) :
Résumé : "${stateT1.summary}"
Stade opérationnel : ${stateT1.operationalState} [preuve : ${formatEvidence(stateT1)}]
Faits nouveaux T1 :
${formatList(stateT1.newFacts)}
Acteurs T1 : ${stateT1.actors.join(', ') || 'aucun'}

T2 — ${formatDate(stateT2.date)} · ${formatSource(stateT2.sourceKind)} (confiance consolidation : ${stateT2.stateConfidence.toFixed(1)}) :
Résumé : "${stateT2.summary}"
Stade opérationnel : ${stateT2.operationalState} [preuve : ${formatEvidence(stateT2)}]
Faits nouveaux T2 :
${formatList(stateT2.newFacts)}
Acteurs T2 : ${stateT2.actors.join(', ') || 'aucun'}
${newFactsHint}`

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

  const pairs: V2SubjectResult['pairs'] = await Promise.all(
    Array.from({ length: consolidatedEvents.length - 1 }, async (_, i) => {
      const t1 = consolidatedEvents[i]
      const t2 = consolidatedEvents[i + 1]
      const result = await classifyEvolution(t1, t2, subject.label)
      return { stateT1: t1, stateT2: t2, result }
    })
  )

  return {
    canonicalSubjectId: subject.canonicalSubjectId,
    subjectLabel: subject.label,
    pairs,
  }
}
