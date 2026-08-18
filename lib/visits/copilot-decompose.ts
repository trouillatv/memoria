// P6-A1 — spike de SEGMENTATION (LLM contraint), avant le routeur d'intention.
//
// Mandat Vincent (2026-08-17) : l'audit du décomposeur déterministe pur a prouvé
// qu'il produit de vrais faux splits dangereux (cas 28 : « Le portail est cassé
// donc c'est le sous-traitant qui doit revenir » — une conséquence, pas deux
// faits) et ne sait pas segmenter une phrase orale sans connecteur lexical
// (cas 42). Verdict : P6-A nécessite un LLM contraint, pas un routeur artisanal
// caché de plus.
//
// Invariants NON NÉGOCIABLES (mandat verbatim) :
//   1. Le LLM ne propose QUE des positions de caractères (start/end) dans le
//      texte ORIGINAL. Jamais de texte, jamais d'intention, jamais d'entité
//      résolue, jamais de reformulation.
//   2. Le serveur reconstruit chaque segment via `rawText.slice(start, end)` —
//      il ne fait JAMAIS confiance à un texte fourni par le LLM.
//   3. `whichIntent()` (ici `detectIntent`, INCHANGÉ) reste la seule autorité
//      sur l'intention de chaque segment. Ce module ne classe rien.
//   4. `dependsOn` peut signaler une dépendance mais ne résout AUCUNE anaphore.
//   5. Toute sortie invalide, incohérente ou `ambiguous:true` → repli immédiat
//      vers un segment unique couvrant tout le texte original.
//
// Hors périmètre P6 (dette explicite, ne pas mélanger) :
//   — NEGATION_SCOPE (impératif négatif mal lu comme écriture positive, cas 38)
//     est une dette du routeur existant, pas de la segmentation.
//   — La provenance d'un fait rapporté (« selon Guillaume ») est une future
//     notion de provenance, pas une responsabilité du décomposeur.
//
// Ce module N'EST PAS branché dans le Copilote réel. C'est un spike isolé.
// Zéro modification de copilot-intent-router.ts, copilot-proposal.ts, des
// writers ou des cartes.

import { z } from 'zod'
import { getAIProvider } from '@/services/ai/factory'
import type { AIProvider, CompletionOutput } from '@/services/ai'
import { detectIntent, type IntentResult } from './copilot-intent-router'

// ── Contrat de sortie ─────────────────────────────────────────────────────────

export type CopilotSegment = {
  start: number
  end: number
  dependsOn: number | null
}

export type DecompositionResult = {
  segments: CopilotSegment[]
  /**
   * true UNIQUEMENT sur un résultat de repli mono-segment. Un découpage
   * multi-segments confiant renvoie toujours `ambiguous: false` — un
   * `ambiguous: true` déclaré par le LLM ne survit jamais jusqu'ici, il est
   * absorbé par `parseDecomposition` (→ null → repli).
   */
  ambiguous: boolean
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const PROMPT_VERSION = 'decompose-v2'

const SYSTEM_PROMPT = `Tu es une couche de SEGMENTATION pour MemorIA, un outil de suivi de chantier.

Une phrase orale (souvent transcrite automatiquement, imparfaite) peut contenir PLUSIEURS unités métier indépendantes dites à la suite : un constat, puis une consigne, puis une autre consigne...

Ton unique travail : découper le texte ORIGINAL en segments, en donnant uniquement leurs POSITIONS DE CARACTÈRES (start/end) dans le texte tel qu'il t'est fourni.

INTERDICTIONS ABSOLUES
- Tu ne renvoies JAMAIS de texte, de résumé ou de reformulation.
- Tu ne classes JAMAIS une intention (aucun champ "intent" n'existe dans ta sortie).
- Tu ne résous JAMAIS une anaphore ("il", "ça", "cette action") : tu peux seulement signaler qu'un segment se rattache au précédent via dependsOn, jamais dire à quoi.
- Si le découpage n'est pas clair, ou si le texte forme un seul geste indivisible, ne force JAMAIS une coupure.

RÈGLE DE SÛRETÉ CAPITALE — UNITÉ NARRATIVE CAUSALE
Un connecteur logique explicite ("donc", "parce que", "car") NE SIGNIFIE PAS automatiquement deux unités, ET SON ABSENCE NE SIGNIFIE PAS non plus deux unités. Juge le RAPPORT ENTRE LES CLAUSES, jamais la présence d'un mot de liaison.
Deux clauses restent UNE SEULE unité métier lorsque la seconde exprime principalement la conséquence, le résultat, l'explication, la justification ou la reformulation de la première — qu'un connecteur causal soit présent ou non.
« Le portail est cassé donc c'est le sous-traitant qui doit revenir » est UNE SEULE unité (connecteur explicite).
« Il pleut depuis ce matin, le coulage est reporté » est UNE SEULE unité (même relation, sans connecteur).
« Plus de courant ce matin, les essais sont décalés » est UNE SEULE unité.
« Le support n'est pas prêt, intervention annulée » est UNE SEULE unité.
À L'INVERSE, découpe en plusieurs unités quand la seconde clause introduit une INTENTION OPÉRATIONNELLE NOUVELLE et AUTONOME (une consigne, une action à créer, un rappel) qui ne se contente pas de décrire l'effet du premier fait :
« Il pleut depuis ce matin, appelle l'entreprise » fait DEUX unités (constat, puis consigne indépendante).
« Le support n'est pas prêt, crée une action pour le reprendre » fait DEUX unités.
Ne découpe que si chaque morceau porte, seul, un sens métier complet et autonome (un constat complet, une consigne complète). En cas de doute → ambiguous=true, avec un seul segment couvrant tout le texte.

CHAMPS
- segments : liste de 1 à 5 objets { start, end, dependsOn }.
  - start / end : indices de caractères dans le texte ORIGINAL (0 = premier caractère), end exclusif.
  - Les segments sont dans l'ORDRE du texte, sans chevauchement.
  - dependsOn : index (0-based) d'un segment PRÉCÉDENT dont celui-ci a besoin pour être compris seul. null si le segment est autonome.
- ambiguous : true si tu n'es pas sûr du découpage, ou si une seule unité couvre tout le texte.

Réponds UNIQUEMENT par le JSON demandé.`

// ── Schémas ───────────────────────────────────────────────────────────────────

/** Nombre raisonnable de segments (mandat Vincent : 4 ou 5). */
export const MAX_SEGMENTS = 5

/** Longueur mini (après trim) pour qu'un segment porte un sens métier. */
const MIN_SEGMENT_CHARS = 2

/**
 * Un intervalle non couvert par un segment (avant le premier, entre deux
 * segments, après le dernier) ne contenant QUE ces caractères est un
 * connecteur structurel neutre — jamais du contenu métier à lui seul.
 * P6-A.1 : remplace l'ancien seuil `MAX_GAP_CHARS`, qui autorisait une
 * perte silencieuse (accepter un gap court sans le rattacher à rien).
 */
const SEPARATOR_ONLY_RE = /^[\s.,;:!?…\-–—()'"«»]*$/u

/**
 * Lettre ou chiffre — un gap qui en contient au moins un porte du contenu
 * métier potentiel et ne peut plus être silencieusement ignoré.
 */
const WORD_CHAR_RE = /[\p{L}\p{N}]/u

/** Longueur max du texte soumis au LLM — garde de coût, pas une contrainte métier. */
const MAX_INPUT_CHARS = 2000

/** Texte trop court pour contenir plusieurs unités — aucun appel LLM. */
const MIN_INPUT_CHARS = 6

const DecompositionSegmentSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  dependsOn: z.number().int().nonnegative().nullable(),
})

const DecompositionRawSchema = z.object({
  segments: z.array(DecompositionSegmentSchema).min(1).max(MAX_SEGMENTS),
  ambiguous: z.boolean(),
})

const DECOMPOSE_GEMINI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'integer' },
          end: { type: 'integer' },
          dependsOn: { type: 'integer', nullable: true },
        },
        required: ['start', 'end', 'dependsOn'],
      },
    },
    ambiguous: { type: 'boolean' },
  },
  required: ['segments', 'ambiguous'],
}

// ── Validation pure (PURE — testable sans LLM) ─────────────────────────────────

/**
 * Valide et durcit la sortie brute du LLM contre le texte original.
 *
 * Retourne `null` si la structure est inexploitable, incohérente, ou si le
 * LLM a lui-même déclaré `ambiguous: true` — dans tous ces cas l'appelant
 * doit répliquer vers un segment unique.
 */
export function parseDecomposition(rawText: string, raw: unknown): DecompositionResult | null {
  const parsed = DecompositionRawSchema.safeParse(raw)
  if (!parsed.success) return null
  const { segments, ambiguous } = parsed.data

  // Ambiguïté déclarée par le LLM → repli, décidé par l'appelant (jamais arbitré ici).
  if (ambiguous) return null

  const textLen = rawText.length

  // Bornes dans le texte + segments non vides (après trim, pour ignorer une
  // coupure sur du pur espace/ponctuation qui ne porte aucun sens métier).
  for (const seg of segments) {
    if (seg.start >= seg.end || seg.end > textLen) return null
    const slice = rawText.slice(seg.start, seg.end).trim()
    if (slice.length < MIN_SEGMENT_CHARS) return null
  }

  // Ordre strictement croissant, aucun chevauchement.
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].start < segments[i - 1].end) return null
  }

  // dependsOn ne peut référencer qu'un segment STRICTEMENT antérieur — jamais
  // lui-même, jamais un segment suivant. Aucune résolution d'anaphore ici.
  for (let i = 0; i < segments.length; i++) {
    const dep = segments[i].dependsOn
    if (dep === null) continue
    if (dep < 0 || dep >= i) return null
  }

  // Aucune perte silencieuse de texte métier : les offsets du LLM ne sont
  // que des propositions de frontière, approximatives par construction — le
  // texte original reste l'unique source de vérité (P6-A.1). Un gap
  // purement séparateur (espace/ponctuation) reste hors segment, inchangé.
  // Un gap qui porte du contenu (lettre/chiffre) n'est JAMAIS ignoré : s'il
  // est collé — sans séparateur — à UN SEUL voisin, c'est une frontière mal
  // placée au milieu d'un mot ou d'un groupe collé, et il lui est rattaché
  // en entier (borne étendue). S'il touche les deux voisins, aucun des deux,
  // ou porte un fragment métier autonome (détaché par des espaces), le
  // rattachement est ambigu : le découpage entier est refusé, jamais résolu
  // arbitrairement — l'appelant réplique alors vers le mono-segment, qui ne
  // perd par construction aucun caractère.
  const cuts: number[] = [0]
  for (const seg of segments) cuts.push(seg.start, seg.end)
  cuts.push(textLen)

  const adjusted = segments.map((s) => ({ ...s }))

  for (let i = 0; i < cuts.length; i += 2) {
    const gapStart = cuts[i]
    const gapEnd = cuts[i + 1]
    if (gapStart >= gapEnd) continue
    const gap = rawText.slice(gapStart, gapEnd)
    if (SEPARATOR_ONLY_RE.test(gap)) continue

    const prevIdx = i / 2 - 1
    const nextIdx = i / 2
    const prevChar = gapStart > 0 ? rawText[gapStart - 1] : ''
    const nextChar = gapEnd < textLen ? rawText[gapEnd] : ''
    const gluedToPrev = prevIdx >= 0 && WORD_CHAR_RE.test(prevChar) && WORD_CHAR_RE.test(gap[0])
    const gluedToNext =
      nextIdx < adjusted.length && WORD_CHAR_RE.test(nextChar) && WORD_CHAR_RE.test(gap[gap.length - 1])

    if (gluedToPrev && !gluedToNext) {
      adjusted[prevIdx].end = gapEnd
    } else if (gluedToNext && !gluedToPrev) {
      adjusted[nextIdx].start = gapStart
    } else {
      return null
    }
  }

  return {
    segments: adjusted.map((s) => ({ start: s.start, end: s.end, dependsOn: s.dependsOn })),
    ambiguous: false,
  }
}

// ── Repli garanti ────────────────────────────────────────────────────────────

/** Le résultat de repli : un seul segment couvrant tout le texte original. */
export function monoSegmentFallback(rawText: string): DecompositionResult {
  return { segments: [{ start: 0, end: rawText.length, dependsOn: null }], ambiguous: true }
}

// ── Appel LLM ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 2500

async function callDecomposeLlm(
  rawText: string,
  opts: { provider?: AIProvider; timeoutMs?: number; onRawCall?: (output: CompletionOutput) => void },
): Promise<unknown | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const provider = opts.provider ?? getAIProvider()
    const call = provider.complete({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: rawText,
      responseSchema: DecompositionRawSchema,
      geminiSchema: DECOMPOSE_GEMINI_SCHEMA,
      modelTier: 'light',
      maxOutputTokens: 300,
    })
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })

    const result = await Promise.race([call, timeout])
    if (!result) return null
    opts.onRawCall?.(result)

    // Certains providers ne renseignent pas `parsed` — on retente sur le texte brut.
    return result.parsed ?? safeJsonParse(result.text)
  } catch (err) {
    console.warn('[copilot-decompose] échec, repli mono-segment:', err)
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

/**
 * Décompose un texte en segments métier indépendants.
 *
 * Garantit TOUJOURS un `DecompositionResult` exploitable — jamais `null`,
 * jamais d'exception. Timeout, erreur provider, JSON invalide, incohérence
 * structurelle ou `ambiguous:true` du LLM retombent tous sur le même repli :
 * un segment unique couvrant le texte original.
 */
export async function decomposeUtterance(
  rawText: string,
  opts: { provider?: AIProvider; timeoutMs?: number; onRawCall?: (output: CompletionOutput) => void } = {},
): Promise<DecompositionResult> {
  if (rawText.trim().length < MIN_INPUT_CHARS) return monoSegmentFallback(rawText)
  if (rawText.length > MAX_INPUT_CHARS) return monoSegmentFallback(rawText)

  const raw = await callDecomposeLlm(rawText, opts)
  if (!raw) return monoSegmentFallback(rawText)

  const parsed = parseDecomposition(rawText, raw)
  if (!parsed) return monoSegmentFallback(rawText)

  return parsed
}

// ── Routage par segment (PURE — n'appelle QUE l'existant, ne le modifie pas) ──

export type RoutedSegment = {
  start: number
  end: number
  text: string
  dependsOn: number | null
  intent: IntentResult
}

/**
 * Reconstruit le texte de chaque segment via `slice` (jamais le texte du
 * LLM) puis appelle le routeur déterministe EXISTANT et INCHANGÉ. Ce module
 * ne décide d'aucune intention — il ne fait que découper avant de déléguer.
 */
export function routeSegments(rawText: string, result: DecompositionResult): RoutedSegment[] {
  return result.segments.map((seg) => {
    const text = rawText.slice(seg.start, seg.end)
    return { start: seg.start, end: seg.end, dependsOn: seg.dependsOn, text, intent: detectIntent(text) }
  })
}

export { PROMPT_VERSION as DECOMPOSE_PROMPT_VERSION }
