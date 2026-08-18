// Copilote V2 — couche de COMPRÉHENSION (LLM léger, avant la classification métier).
//
// Doctrine (retour terrain Guillaume, 2026-08) :
//   « Le LLM ne doit pas remplacer les moteurs MemorIA ; il doit devenir le traducteur
//     entre la façon imparfaite dont un humain parle et la structure précise derrière. »
//
// Invariants NON NÉGOCIABLES :
//   1. Cette couche NE RÉPOND JAMAIS à une question. Elle produit une structure, rien d'autre.
//   2. Elle ne lit ni n'écrit JAMAIS en base. Aucune donnée du chantier ne lui est transmise.
//   3. Elle ne possède JAMAIS l'autorité de déclencher une mutation. `POSSIBLE_WRITE` ne
//      produit au mieux qu'un BROUILLON soumis à validation humaine explicite.
//   4. Toute ambiguïté retombe côté READ.
//   5. Timeout, erreur réseau, JSON invalide, entité hallucinée → `null`, et le pipeline
//      déterministe existant reprend la main SILENCIEUSEMENT. Le Copilote reste
//      fonctionnel sans LLM.

import { z } from 'zod'
import { getAIProvider } from '@/services/ai/factory'
import type { AIProvider } from '@/services/ai'
import { normalizeQuery, type IntentResult } from './copilot-intent-router'
import { classifyReadIntent, type IntentClassification, type IntentFamily } from './copilot-classify'

// ── Contrat de sortie ─────────────────────────────────────────────────────────

export type ComprehensionMode = 'read' | 'possible_write' | 'unknown'

/** Étiquettes fermées — le LLM ne peut rien produire hors de cette liste. */
export const COMPREHENSION_LABELS = [
  'READ_SITE_STATUS',
  'READ_NEXT_VISIT',
  'READ_ACTION_STATUS',
  'READ_SUBJECT',
  'READ_RECENT_CHANGES',
  'POSSIBLE_WRITE',
  'UNKNOWN',
] as const
export type ComprehensionLabel = (typeof COMPREHENSION_LABELS)[number]

/** Intentions normalisées — vocabulaire fermé, jamais du texte libre. */
export const COMPREHENSION_INTENTS = [
  'site_status',
  'prepare_next_visit',
  'action_status',
  'subject_status',
  'subject_evolution',
  'recent_changes',
  'stale_subjects',
  'add_visit_item',
  'create_action',
  'schedule_visit',
  'schedule_meeting',
  'other',
] as const
export type ComprehensionIntent = (typeof COMPREHENSION_INTENTS)[number]

export const COMPREHENSION_TIME_SCOPES = ['since_last_visit', 'next_visit', 'recent', 'none'] as const
export type ComprehensionTimeScope = (typeof COMPREHENSION_TIME_SCOPES)[number]

export type ComprehensionConfidence = 'high' | 'medium' | 'low'

export type Comprehension = {
  mode: ComprehensionMode
  label: ComprehensionLabel
  intent: ComprehensionIntent
  /** Indices de sujet — TOUJOURS des mots réellement présents dans la question. */
  entities: string[]
  timeScope: ComprehensionTimeScope
  confidence: ComprehensionConfidence
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const PROMPT_VERSION = 'comprehension-v1'

const SYSTEM_PROMPT = `Tu es une couche de COMPRÉHENSION LINGUISTIQUE pour MemorIA, un outil de suivi de chantier.

Ton unique travail : traduire une phrase humaine, souvent orale et imparfaite ("euh demain quand j'y retourne qu'est-ce que je regarde ?"), en une structure fermée.

INTERDICTIONS ABSOLUES
- Tu ne réponds JAMAIS à la question.
- Tu n'inventes JAMAIS de sujet, de code technique, de nom d'entreprise ou de date.
- Tu ne connais RIEN du chantier : tu n'as aucune donnée. Tu analyses uniquement la formulation.
- Tu ne déclenches JAMAIS d'écriture. Au mieux tu signales qu'une écriture est POSSIBLE.

ÉTIQUETTES (choisis-en exactement une)
- READ_SITE_STATUS : demande d'état général du chantier ("où en est le chantier", "tu me fais le point ?").
- READ_NEXT_VISIT : ce qu'il faut regarder / contrôler / préparer lors du prochain passage.
- READ_ACTION_STATUS : actions, tâches, retards, engagements, ce qui traîne ou n'a pas bougé.
- READ_SUBJECT : question portant sur UN sujet précis nommé dans la phrase ("les toilettes", "le cadenas", "R4").
- READ_RECENT_CHANGES : ce qui a changé, évolué, bougé depuis la dernière fois.
- POSSIBLE_WRITE : ORDRE explicite d'enregistrer quelque chose ("ajoute…", "note…", "crée…", "planifie…").
- UNKNOWN : rien de tout cela.

RÈGLE DE SÛRETÉ CAPITALE
Une question sur ce qu'il FAUT vérifier n'est PAS un ordre.
- "est-ce qu'il faut vérifier les toilettes ?" → READ_SUBJECT (ou READ_NEXT_VISIT), jamais POSSIBLE_WRITE.
- "qu'est-ce qu'il faut que je regarde demain ?" → READ_NEXT_VISIT.
- "ajoute les toilettes à ma prochaine visite" → POSSIBLE_WRITE.
En cas de doute, choisis TOUJOURS une étiquette READ_*.

CHAMPS
- label : une étiquette ci-dessus.
- intent : site_status | prepare_next_visit | action_status | subject_status | subject_evolution | recent_changes | stale_subjects | add_visit_item | create_action | schedule_visit | schedule_meeting | other
- entities : 0 à 3 groupes de mots RECOPIÉS TELS QUELS depuis la phrase, désignant l'objet concret ("toilettes", "cadenas", "R4"). Jamais un mot générique ("chantier", "travaux", "truc"). Liste vide si aucun objet précis.
- time_scope : since_last_visit | next_visit | recent | none
- confidence : high | medium | low

Réponds UNIQUEMENT par le JSON demandé.`

// ── Schémas ───────────────────────────────────────────────────────────────────

const ComprehensionRawSchema = z.object({
  label: z.enum(COMPREHENSION_LABELS),
  intent: z.enum(COMPREHENSION_INTENTS),
  entities: z.array(z.string()).max(5).default([]),
  time_scope: z.enum(COMPREHENSION_TIME_SCOPES),
  confidence: z.enum(['high', 'medium', 'low']),
})

const COMPREHENSION_GEMINI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    label: { type: 'string', enum: [...COMPREHENSION_LABELS] },
    intent: { type: 'string', enum: [...COMPREHENSION_INTENTS] },
    entities: { type: 'array', items: { type: 'string' } },
    time_scope: { type: 'string', enum: [...COMPREHENSION_TIME_SCOPES] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['label', 'intent', 'entities', 'time_scope', 'confidence'],
}

// ── Normalisation / garde-fous ────────────────────────────────────────────────

/** Mots trop génériques pour désigner un sujet canonique — jamais retenus comme entité. */
const GENERIC_ENTITY_WORDS = new Set([
  'chantier', 'projet', 'travaux', 'truc', 'chose', 'site', 'affaire',
  'dossier', 'boulot', 'machin', 'reste', 'suite', 'point', 'points',
])

/**
 * Ne conserve que les entités RÉELLEMENT présentes dans la question.
 *
 * C'est la garde anti-hallucination : elle rend structurellement impossible
 * qu'un sujet d'un autre chantier (défaut « De quoi dépend l'avis G3 ? » sur
 * PETRO ATITI) soit introduit par le LLM.
 */
export function sanitizeEntities(question: string, raw: string[]): string[] {
  const nq = normalizeQuery(question)
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length < 3 || trimmed.length > 60) continue
    const n = normalizeQuery(trimmed)
    if (!n || n.length < 3) continue
    if (GENERIC_ENTITY_WORDS.has(n)) continue
    if (!nq.includes(n)) continue // hallucination → rejet
    if (seen.has(n)) continue
    seen.add(n)
    out.push(trimmed)
    if (out.length === 3) break
  }
  return out
}

function modeForLabel(label: ComprehensionLabel): ComprehensionMode {
  if (label === 'POSSIBLE_WRITE') return 'possible_write'
  if (label === 'UNKNOWN') return 'unknown'
  return 'read'
}

/**
 * Valide et durcit la sortie brute du LLM.
 * Retourne `null` si la structure est inexploitable → repli déterministe.
 */
export function parseComprehension(question: string, raw: unknown): Comprehension | null {
  const parsed = ComprehensionRawSchema.safeParse(raw)
  if (!parsed.success) return null
  const { label, intent, entities, time_scope, confidence } = parsed.data

  const clean = sanitizeEntities(question, entities)

  // READ_SUBJECT sans entité exploitable ne cible rien : c'est une question générale.
  const effectiveLabel: ComprehensionLabel =
    label === 'READ_SUBJECT' && clean.length === 0 ? 'READ_SITE_STATUS' : label

  return {
    mode: modeForLabel(effectiveLabel),
    label: effectiveLabel,
    intent,
    entities: clean,
    timeScope: time_scope,
    confidence,
  }
}

// ── Appel LLM ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 2500

/**
 * Comprend la question. Ne répond pas, ne lit pas la base.
 *
 * Retourne `null` en cas de timeout, d'erreur provider ou de JSON invalide :
 * l'appelant doit alors poursuivre avec le pipeline déterministe, sans message
 * d'erreur pour l'utilisateur.
 */
export async function understandQuestion(
  question: string,
  opts: { provider?: AIProvider; timeoutMs?: number } = {},
): Promise<Comprehension | null> {
  const trimmed = question.trim()
  if (trimmed.length < 2 || trimmed.length > 500) return null

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const provider = opts.provider ?? getAIProvider()
    const call = provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: trimmed,
      responseSchema: ComprehensionRawSchema,
      geminiSchema: COMPREHENSION_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: 200,
    })
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })

    const result = await Promise.race([call, timeout])
    if (!result) return null

    // Certains providers ne renseignent pas `parsed` — on retente sur le texte brut.
    const raw = result.parsed ?? safeJsonParse(result.text)
    if (!raw) return null

    return parseComprehension(trimmed, raw)
  } catch (err) {
    console.warn('[copilot-comprehension] échec, repli déterministe:', err)
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function safeJsonParse(text: string): unknown {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

// ── Fusion avec le pipeline déterministe (PURE — testable sans LLM) ───────────

const LABEL_TO_FAMILY: Record<Exclude<ComprehensionLabel, 'POSSIBLE_WRITE' | 'UNKNOWN'>, IntentFamily> = {
  READ_SITE_STATUS:    'global',
  READ_NEXT_VISIT:     'plan_visite',
  READ_ACTION_STATUS:  'action_status',
  READ_SUBJECT:        'subject_detail',
  READ_RECENT_CHANGES: 'timeline',
}

/** Intentions d'écriture que le pipeline sait réellement transformer en brouillon. */
const WRITE_INTENT_TO_ROUTER: Partial<Record<ComprehensionIntent, IntentResult['intent']>> = {
  add_visit_item:   'ADD_VISIT_ITEM',
  create_action:    'CREATE_ACTION',
  schedule_visit:   'SCHEDULE_VISIT',
  schedule_meeting: 'SCHEDULE_MEETING',
}

export type ComprehensionMerge = {
  classification: IntentClassification
  intentResult: IntentResult
  /**
   * Les subjectLabels proviennent d'un indice LLM et non d'un code technique ou
   * de guillemets tapés par l'utilisateur. Une résolution infructueuse ne doit
   * alors PAS produire un « Je ne trouve aucun sujet… » péremptoire.
   */
  subjectHintsFromLlm: boolean
  /** Trace des règles appliquées — télémétrie et tests. */
  applied: string[]
}

/**
 * Fusionne la compréhension LLM avec le résultat déterministe.
 *
 * Le déterministe reste la référence. Le LLM ne peut que :
 *   — RÉTROGRADER une écriture faiblement détectée vers une lecture ;
 *   — PRÉCISER une intention d'écriture déjà détectée mais non résolue
 *     (UNKNOWN_WRITE → brouillon ciblé, soumis à validation humaine) ;
 *   — ORIENTER la famille de lecture et fournir des indices de sujet.
 *
 * Il ne peut JAMAIS transformer une lecture en écriture.
 */
export function mergeComprehension(
  question: string,
  classification: IntentClassification,
  intentResult: IntentResult,
  comprehension: Comprehension | null,
): ComprehensionMerge {
  const applied: string[] = []
  if (!comprehension) {
    return { classification, intentResult, subjectHintsFromLlm: false, applied }
  }

  let nextIntent = intentResult
  let nextClassification = classification
  let subjectHintsFromLlm = false

  // ── 1. Rétrogradation de sûreté ────────────────────────────────────────────
  // Écriture DÉDUITE (confiance déterministe 'ambiguous') alors que la compréhension
  // y voit une question → lecture. Rétrograder est toujours sûr : au pire une
  // commande est traitée comme une question, jamais l'inverse.
  //
  // Deux verrous :
  //   — une écriture déterministe 'strong' n'est jamais rétrogradée ;
  //   — un verbe d'écriture explicite ("ajoute", "planifie") exige une compréhension
  //     franche (high). Cas visé : « tu me FAIS le point sur le chantier ? », où
  //     "fais" est un faux positif de verbe d'écriture.
  //
  // OBSERVATION est exemptée : le garde-fou READ du routeur déterministe s'exécute
  // AVANT la branche OBSERVATION (si isRead && !isWrite, on repart déjà en READ sans
  // jamais atteindre Priorité 4bis) — une vraie question ne peut donc pas atteindre
  // OBSERVATION. La compréhension n'a ici aucun concept d'observation factuelle
  // (COMPREHENSION_LABELS n'en propose pas) : elle classe systématiquement un constat
  // déclaratif en 'read' faute de mieux, ce qui annulerait la capture sans apporter
  // de sûreté réelle.
  const hasExplicitWriteVerb =
    intentResult.signals.includes('write_verb') || intentResult.signals.includes('schedule_verb')

  if (
    comprehension.mode === 'read' &&
    intentResult.intent !== 'READ' &&
    intentResult.intent !== 'OBSERVATION' &&
    intentResult.confidence === 'ambiguous' &&
    comprehension.confidence !== 'low' &&
    (!hasExplicitWriteVerb || comprehension.confidence === 'high')
  ) {
    nextIntent = {
      intent: 'READ',
      confidence: 'ambiguous',
      signals: [...intentResult.signals, 'llm_read_downgrade'],
    }
    nextClassification = classifyReadIntent(question)
    applied.push('read_downgrade')
  }

  // ── 2. Précision d'une écriture non résolue ────────────────────────────────
  // UNKNOWN_WRITE = « Je n'ai pas bien compris votre intention ». Si la
  // compréhension identifie une écriture possible ET une cible connue du
  // pipeline, on produit un BROUILLON ciblé. Aucune écriture n'a lieu ici :
  // l'utilisateur devra valider explicitement la carte de proposition.
  //
  // S'applique aussi à une écriture déterministe 'ambiguous' : on ne crée pas
  // l'écriture, on précise seulement la cible d'un brouillon déjà décidé.
  //
  // Exception : si le déterministe a posé 'negated_write_verb' (NEGATION_SCOPE),
  // UNKNOWN_WRITE n'est pas une intention floue à préciser mais un verdict — la
  // négation orale a délibérément bloqué la branche d'écriture. Le LLM n'a
  // aucune notion de négation (le prompt ne la mentionne pas) : le laisser
  // reclasser ici annulerait silencieusement le jugement du routeur (terrain
  // OCEF 2026-08-18 : « Ne planifie pas de réunion vendredi » → SCHEDULE_MEETING).
  const writeIsUnresolved =
    !nextIntent.signals.includes('negated_write_verb') &&
    (nextIntent.intent === 'UNKNOWN_WRITE' ||
      (nextIntent.intent !== 'READ' && nextIntent.confidence === 'ambiguous'))

  if (writeIsUnresolved && comprehension.mode === 'possible_write') {
    const mapped = WRITE_INTENT_TO_ROUTER[comprehension.intent]
    if (mapped && mapped !== nextIntent.intent) {
      nextIntent = {
        intent: mapped,
        confidence: 'ambiguous',
        signals: [...nextIntent.signals, 'llm_possible_write'],
      }
      applied.push('possible_write_refined')
    }
  }

  // ── 3. Aucune promotion lecture → écriture ─────────────────────────────────
  // Le LLM croit voir une écriture mais le déterministe lit une question :
  // l'ambiguïté retombe côté READ. Trace conservée pour l'observatoire.
  if (nextIntent.intent === 'READ' && comprehension.mode === 'possible_write') {
    applied.push('possible_write_ignored')
  }

  // Chemin écriture (hors OBSERVATION) : la compréhension n'a plus rien à apporter.
  if (nextIntent.intent !== 'READ' && nextIntent.intent !== 'OBSERVATION') {
    return { classification: nextClassification, intentResult: nextIntent, subjectHintsFromLlm, applied }
  }

  // ── 4. Orientation de la famille de lecture ────────────────────────────────
  // N'a de sens que pour READ : OBSERVATION n'a pas de "famille" de lecture,
  // et classification.primary y sert à autre chose (cf. copilot-classify.ts).
  if (nextIntent.intent === 'READ') {
    const labelFamily = comprehension.label === 'POSSIBLE_WRITE' || comprehension.label === 'UNKNOWN'
      ? null
      : LABEL_TO_FAMILY[comprehension.label]

    // Affinage par l'INTENTION quand l'étiquette est trop grossière. Les étiquettes
    // ne distinguent pas « qu'est-ce qui n'avance pas ? » (stagnation d'un sujet)
    // de « quelles actions sont en retard ? » (date dépassée) : les deux tombent
    // sur READ_ACTION_STATUS. L'intention `stale_subjects`, elle, les sépare — et
    // c'est cette confusion qui a produit « aucune action en retard » sur PETRO.
    const family: IntentFamily | null =
      comprehension.intent === 'stale_subjects' && labelFamily !== null
        ? 'stagnation'
        : labelFamily

    if (family && family !== nextClassification.primary) {
      // Le déterministe n'a rien trouvé ("global" = aucun signal) → le LLM tranche.
      // Sinon on n'écrase que sur une compréhension franche.
      const deterministicIsBlind = nextClassification.primary === 'global'
      // Une stagnation détectée déterministiquement ("n'avance pas", "stagne") est
      // une formulation explicite : le LLM ne la rétrograde pas vers les actions.
      const wouldDowngradeStagnation = nextClassification.primary === 'stagnation'
      if (!wouldDowngradeStagnation && (deterministicIsBlind || comprehension.confidence === 'high')) {
        const previous = nextClassification.primary
        nextClassification = {
          ...nextClassification,
          primary: family,
          secondary: previous === family || previous === 'global'
            ? nextClassification.secondary
            : [previous, ...nextClassification.secondary.filter((s) => s !== family)],
        }
        applied.push(`family:${family}`)
      }
    }
  }

  // ── 5. Indices de sujet ────────────────────────────────────────────────────
  // Uniquement en complément : jamais à la place d'un code technique ou d'une
  // citation entre guillemets tapés par l'utilisateur. S'applique aussi à
  // OBSERVATION : canonical_subject_id est NOT NULL en base (mig 291), un constat
  // sans sujet résolu ne peut pas devenir un brouillon — l'entité déjà validée par
  // sanitizeEntities() est la seule source de résolution pour une phrase déclarative
  // sans code technique ni guillemets ("Le cadenas...", "Clim Expair n'est pas venu...").
  if (comprehension.entities.length > 0 && nextClassification.entities.subjectLabels.length === 0) {
    nextClassification = {
      ...nextClassification,
      entities: { ...nextClassification.entities, subjectLabels: [...comprehension.entities] },
    }
    subjectHintsFromLlm = true
    applied.push('subject_hints')
  }

  return { classification: nextClassification, intentResult: nextIntent, subjectHintsFromLlm, applied }
}

export { PROMPT_VERSION as COMPREHENSION_PROMPT_VERSION }
