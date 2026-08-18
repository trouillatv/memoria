// P3-B — normalisation déterministe d'un transcript contre un vocabulaire FERMÉ.
//
// Pourquoi : Gemini Live transcrit vite et bien le français courant, mais écrit
// les noms propres du chantier de façon phonétique (« pétro à Titi », « Vincent
// Millon » — campagne du 16/08, 17 essais). Ces erreurs sont stables, donc
// corrigeables sans deviner : il suffit de les rapprocher d'une liste finie de
// termes qui existent réellement dans le contexte de l'utilisateur.
//
// Ce que ce module ne fait PAS, et ne doit jamais faire :
//   - corriger du français libre ou un verbe. « Envoie un message » entendu
//     « On voit un message » est une erreur d'INTENTION : aucun vocabulaire
//     fermé ne la rattrape, et tenter de la corriger reviendrait à deviner ce
//     que l'utilisateur voulait dire. C'est la barrière lecture/mutation qui
//     doit traiter ce cas, pas la transcription.
//   - appeler un modèle. Une correction non déterministe ne serait pas
//     auditable, et une correction non auditable sur une commande vocale est
//     pire que pas de correction du tout.
//   - corriger quand deux termes réels sont également plausibles. On préfère
//     laisser passer une faute qu'écrire le nom d'un autre acteur du chantier.
//   - réécrire le transcript à partir d'un `business_alias` ou d'un alias de
//     mémoire sémantique (Q4.5, Vincent 2026-08-18). Ces alias résolvent une
//     IDENTITÉ pendant la compréhension (« clim » peut désigner l'entreprise
//     Clim Expair) ; ils ne prouvent jamais qu'un mot du français courant a
//     été PRONONCÉ à la place du nom propre. « La clim est en retard » ne
//     doit jamais devenir « Clim Expair est en retard » au seul motif que cet
//     alias existe — ce serait fabriquer un fait non prononcé. Seuls
//     `known_mistranscription` et `actor_alias`/`transcription_alias` sont
//     des corrections de RECONNAISSANCE, donc éligibles à la réécriture.
//
// Module PUR : aucune I/O, aucune dépendance serveur. Le vocabulaire lui est
// fourni par `lib/ai/stt-vocabulary.ts`.

/** D'où vient une forme de surface — pure traçabilité, ne pèse jamais sur le matching. */
export type VocabularyFormSource =
  | 'canonical_name'
  | 'short_name'
  | 'actor_alias'
  | 'knowledge_alias'
  | 'known_mistranscription'

/**
 * Une forme de surface et sa provenance. Ajouté pour Q6 (audit BECIB, 17-18/08) :
 * distinguer dans les traces une correction issue d'un `actor_alias` confirmé
 * d'un simple rapprochement flou sur le nom canonique. Champ purement additif —
 * `normalizeTranscript` ne lit jamais `source`/`aliasNature`/`actorId` pour
 * décider d'une correction, seulement `value`.
 */
export type VocabularyForm = {
  value: string
  source: VocabularyFormSource
  /** Renseigné seulement quand `source === 'actor_alias'`. */
  aliasNature?: 'business_alias' | 'transcription_alias'
  /** `company_id`/`contact_id` de l'acteur visé, quand `source === 'actor_alias'`. */
  actorId?: string
  canonicalValue: string
}

/** Un terme du vocabulaire fermé : ce qu'on écrit, et tout ce qui doit le viser. */
export type VocabularyTerm = {
  /** Forme écrite retenue en cas de correction. */
  canonical: string
  kind: 'site' | 'company' | 'person' | 'acronym' | 'expression'
  /** Formes de surface acceptées (inclut toujours `canonical`). */
  forms: VocabularyForm[]
}

export type TranscriptCorrection = {
  from: string
  to: string
  kind: VocabularyTerm['kind']
  /** Distance d'édition sur la forme compactée — 0 = simple reformatage. */
  distance: number
  /** Provenance de la forme qui a déclenché la correction (Q6). */
  source: VocabularyFormSource
  aliasNature?: 'business_alias' | 'transcription_alias'
  actorId?: string
}

export type TranscriptAbstention = {
  span: string
  candidates: string[]
}

export type NormalizedTranscript = {
  text: string
  corrections: TranscriptCorrection[]
  /** Cas où plusieurs termes réels étaient plausibles : rien n'a été touché. */
  abstentions: TranscriptAbstention[]
}

/**
 * Minuscules, sans diacritiques, sans ponctuation.
 *
 * Volontairement NON importée de `normalizeCanonicalLabel` (lib/db) : ce module
 * doit rester pur et sans `server-only`, et surtout un réglage fait pour la
 * réconciliation de sujets ne doit pas pouvoir modifier silencieusement des
 * transcriptions vocales.
 */
// `normalize`/`compact`/`levenshtein`/`STOP_WORDS` sont exportées (purement
// additif) pour `lib/ai/alias-plausibility.ts` (Q5) : la plausibilité d'un
// `transcription_alias` doit se juger avec EXACTEMENT le même rapprochement
// que celui qui décide une réécriture, pas une seconde implémentation qui
// pourrait diverger.
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Forme compactée : c'est sur elle que se joue « pétro à Titi » ≈ « PETRO ATTITI ». */
export function compact(s: string): string {
  return normalize(s).replace(/ /g, '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * Tolérance, volontairement sévère et croissante avec la longueur.
 *
 * Un sigle court n'a AUCUNE tolérance : « CSI » ne doit jamais devenir « SSI »
 * (une lettre sur trois, c'est un autre mot, pas une faute d'orthographe).
 * Au-delà, une seule substitution suffit à couvrir les erreurs observées
 * (Millon→Milon, petroatiti→petroattiti) sans ouvrir la porte à autre chose.
 */
export function maxDistanceFor(length: number): number {
  if (length <= 5) return 0
  if (length <= 12) return 1
  return Math.floor(length * 0.12)
}

/** Mots trop courants pour qu'une fenêtre composée d'eux seuls vise un nom propre. */
export const STOP_WORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'au', 'aux', 'en', 'a', 'et', 'ou',
  'sur', 'pour', 'par', 'dans', 'avec', 'sans', 'ce', 'cette', 'ces', 'il', 'elle', 'on',
  'je', 'tu', 'nous', 'vous', 'ils', 'elles', 'qui', 'que', 'quoi', 'est', 'sont', 'a',
])

/** Longueur compactée minimale pour qu'un terme soit éligible au rapprochement. */
const MIN_TERM_LENGTH = 3
/** Nombre de jetons qu'une fenêtre peut ajouter au terme visé (« à Titi » = +1). */
const MAX_EXTRA_TOKENS = 1

type Token = { text: string; norm: string; start: number; end: number }

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const re = /[\p{L}\p{N}]+/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const norm = normalize(m[0])
    if (norm) tokens.push({ text: m[0], norm, start: m.index, end: m.index + m[0].length })
  }
  return tokens
}

type Match = {
  from: number   // index de jeton (inclus)
  to: number     // index de jeton (exclu)
  term: VocabularyTerm
  form: VocabularyForm
  distance: number
}

/**
 * Une forme peut IDENTIFIER un acteur (résolution/compréhension) sans jamais
 * prouver qu'elle a été PRONONCÉE (Q4.5). Seules les corrections de
 * reconnaissance vocale — nom canonique, nom court, faute connue,
 * `transcription_alias` confirmé — réécrivent le transcript. Un
 * `business_alias` (« clim » → Clim Expair) ou un alias de mémoire
 * sémantique (« l'élec » → Élec Plus, mig. 248) restent dans le vocabulaire
 * pour la compréhension en aval, mais ne sont jamais des cibles de réécriture.
 */
function isRewriteEligible(form: VocabularyForm): boolean {
  if (form.source === 'actor_alias') return form.aliasNature === 'transcription_alias'
  if (form.source === 'knowledge_alias') return false
  return true
}

/**
 * Rapproche un transcript d'un vocabulaire fermé et réécrit uniquement les
 * empans dont la cible est certaine.
 *
 * Contrat : tout ce qui n'est pas une correction retenue est rendu inchangé,
 * caractère pour caractère. Aucune correction n'est silencieuse — chacune est
 * rendue dans `corrections`, et les renoncements dans `abstentions`.
 */
export function normalizeTranscript(text: string, vocabulary: VocabularyTerm[]): NormalizedTranscript {
  const tokens = tokenize(text)
  if (tokens.length === 0 || vocabulary.length === 0) {
    return { text, corrections: [], abstentions: [] }
  }

  // Chaque forme de surface devient une cible ; la canonique reste ce qu'on écrit.
  const targets: Array<{ term: VocabularyTerm; form: VocabularyForm; compact: string; tokenCount: number }> = []
  for (const term of vocabulary) {
    const seen = new Set<string>()
    const forms: VocabularyForm[] = term.forms.length
      ? term.forms
      : [{ value: term.canonical, source: 'canonical_name', canonicalValue: term.canonical }]
    for (const form of forms) {
      if (!isRewriteEligible(form)) continue
      const c = compact(form.value)
      if (c.length < MIN_TERM_LENGTH || seen.has(c)) continue
      seen.add(c)
      targets.push({ term, form, compact: c, tokenCount: normalize(form.value).split(' ').filter(Boolean).length })
    }
  }
  if (targets.length === 0) return { text, corrections: [], abstentions: [] }

  const matches: Match[] = []
  const abstentions: TranscriptAbstention[] = []

  for (const target of targets) {
    const tolerance = maxDistanceFor(target.compact.length)
    const minSize = Math.max(1, target.tokenCount - MAX_EXTRA_TOKENS)
    const maxSize = target.tokenCount + MAX_EXTRA_TOKENS
    for (let size = minSize; size <= maxSize; size++) {
      for (let i = 0; i + size <= tokens.length; i++) {
        const window = tokens.slice(i, i + size)
        // Une fenêtre entièrement composée de mots-outils ne vise pas un nom propre.
        if (window.every((t) => STOP_WORDS.has(t.norm))) continue
        const windowCompact = window.map((t) => t.norm).join('')
        const distance = levenshtein(windowCompact, target.compact)
        if (distance <= tolerance) matches.push({ from: i, to: i + size, term: target.term, form: target.form, distance })
      }
    }
  }
  if (matches.length === 0) return { text, corrections: [], abstentions: [] }

  // Meilleure distance d'abord, puis empan le plus long : « pétro à Titi » (3
  // jetons) doit l'emporter sur un rapprochement partiel de « pétro » seul.
  matches.sort((a, b) => a.distance - b.distance || (b.to - b.from) - (a.to - a.from) || a.from - b.from)

  const taken = new Array<boolean>(tokens.length).fill(false)
  const corrections: TranscriptCorrection[] = []
  const replacements: Array<{ start: number; end: number; to: string }> = []

  for (const match of matches) {
    let free = true
    for (let i = match.from; i < match.to && free; i++) if (taken[i]) free = false
    if (!free) continue

    // Ambiguïté : un AUTRE terme réel vise le même empan d'aussi près. On ne
    // tranche pas — écrire le nom d'un autre acteur serait pire que la faute.
    const rivals = matches.filter(
      (m) =>
        m.from === match.from && m.to === match.to &&
        m.distance === match.distance && m.term.canonical !== match.term.canonical,
    )
    if (rivals.length > 0) {
      const span = text.slice(tokens[match.from].start, tokens[match.to - 1].end)
      for (let i = match.from; i < match.to; i++) taken[i] = true
      abstentions.push({
        span,
        candidates: [match.term.canonical, ...rivals.map((r) => r.term.canonical)],
      })
      continue
    }

    for (let i = match.from; i < match.to; i++) taken[i] = true
    const start = tokens[match.from].start
    const end = tokens[match.to - 1].end
    const span = text.slice(start, end)
    if (span === match.term.canonical) continue // déjà juste : rien à signaler
    replacements.push({ start, end, to: match.term.canonical })
    corrections.push({
      from: span,
      to: match.term.canonical,
      kind: match.term.kind,
      distance: match.distance,
      source: match.form.source,
      ...(match.form.aliasNature ? { aliasNature: match.form.aliasNature } : {}),
      ...(match.form.actorId ? { actorId: match.form.actorId } : {}),
    })
  }

  if (replacements.length === 0) return { text, corrections: [], abstentions }

  replacements.sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const r of replacements) {
    out += text.slice(cursor, r.start) + r.to
    cursor = r.end
  }
  out += text.slice(cursor)

  return { text: out, corrections, abstentions }
}
