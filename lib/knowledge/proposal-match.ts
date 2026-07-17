// ── RECONNAÎTRE UN FAIT DÉJÀ CONNU ───────────────────────────────────────────
// « Une reformulation ne crée jamais à elle seule un nouvel objet métier. Une
// décision humaine confirmée reste l'autorité ; toute nouvelle extraction doit
// d'abord tenter de s'y rattacher. » (Vincent, 2026-07-17)
//
// Le problème, observé en vrai sur une visite :
//   v1 → « Faire évacuer les gravats du local technique par Sotrap »  CONFIRMÉE
//   v2 → « Demander à Sotrap d'évacuer les gravats du local technique »  proposée
// Même fait. Deux dedupe_key, parce que la clé est un sha1 du TITRE : le modèle
// reformule, la clé change, et MemorIA re-propose au conducteur ce qu'il vient de
// valider. Plus il confirme, plus les doublons s'accumulent. Confirmer ne protège
// de rien.
//
// ── CE QUE CE MODULE NE FAIT JAMAIS ────────────────────────────────────────
// Il ne modifie RIEN. Il ne remplace pas une action par « une meilleure
// formulation ». Il rend un VERDICT, et le verdict est une donnée, pas un effet.
// Un objet confirmé est la parole d'un humain : aucun score ne la réécrit.
//
// Ce fichier est PUR — aucune base, aucun LLM, aucune date. Il se teste sur des
// chaînes, ce qui est exactement ce qu'il faut pour un jugement de langage.

/** Pourquoi deux faits ont été rapprochés — observable, jamais un score nu. */
export type MatchReason =
  | 'same_owner'
  | 'same_location'
  | 'same_subject'
  | 'same_due_window'
  | 'same_source'
  | 'semantic_similarity'
  | 'model_reference'

/**
 * L'issue d'un rapprochement. Trois états, et aucun n'écrit :
 *
 * - `new` : aucun rapprochement crédible. La proposition s'affiche.
 * - `matched` : le MÊME fait, sans doute possible. La proposition ne s'affiche
 *   pas ; seule sa preuve rejoint l'objet existant.
 * - `possible_duplicate` : ça ressemble, sans certitude. L'humain tranche —
 *   c'est un filet de sécurité, pas le mécanisme principal.
 */
export type ProposalMatch =
  | { status: 'new' }
  | { status: 'matched'; objectType: string; objectId: string; confidence: number; reasons: MatchReason[] }
  | { status: 'possible_duplicate'; objectType: string; objectId: string; confidence: number; reasons: MatchReason[] }

/** Un fait déjà connu, tel que le moteur le compare. */
export interface MatchCandidate {
  objectType: string
  objectId: string
  title: string
  owner: string | null
  due: string | null
  /** La visite dont il est issu — la provenance renforce, elle ne décide pas. */
  sourceReportId: string | null
}

/** La proposition à juger. */
export interface MatchSubject {
  title: string
  owner: string | null
  due: string | null
  sourceReportId: string | null
}

// ── Normalisation ────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Les mots qui ne disent RIEN du fait — articles, auxiliaires, et surtout les
 * verbes d'injonction dont le modèle change à chaque lecture : « faire »,
 * « demander », « prévoir ». C'est précisément là que la reformulation se joue.
 * « Faire évacuer » et « Demander à Sotrap d'évacuer » ne diffèrent que par eux.
 */
const VIDES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l', 'a', 'au', 'aux',
  'et', 'ou', 'en', 'par', 'pour', 'dans', 'sur', 'sous', 'avec', 'est', 'sont',
  'faire', 'fait', 'demander', 'demande', 'prevoir', 'prevu', 'obtenir',
  'realiser', 'effectuer', 'proceder', 'penser', 'veiller', 'etre', 'avoir',
  'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'qui', 'que',
])

/** Ce dont le fait PARLE : les mots qui restent quand on retire le bruit. */
export function contentWords(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((w) => w.length > 2 && !VIDES.has(w)),
  )
}

/** Jaccard sur les mots de contenu — 1 = mêmes mots, 0 = rien en commun. */
export function subjectOverlap(a: string, b: string): number {
  const A = contentWords(a)
  const B = contentWords(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}

/** Ce que les deux disent, et qu'un seul dit — ce second ensemble est le doute. */
function distinctifs(a: string, b: string): Set<string> {
  const A = contentWords(a)
  const B = contentWords(b)
  const out = new Set<string>()
  for (const w of A) if (!B.has(w)) out.add(w)
  for (const w of B) if (!A.has(w)) out.add(w)
  return out
}

function sameOwner(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return false
  // « Sotrap » et « Paul Vernier (Sotrap) » désignent le même responsable.
  return na === nb || na.includes(nb) || nb.includes(na)
}

// ── Seuils ───────────────────────────────────────────────────────────────────
// Volontairement PRUDENTS. Un faux « matched » fait disparaître une vraie
// proposition sans que personne ne l'ait décidé — c'est pire qu'un doublon, qui
// se voit et s'écarte d'un geste.
const SEUIL_MATCHED = 0.85
const SEUIL_DOUTE = 0.45

/**
 * Le verdict, sur les seuls champs déjà présents. Aucun embedding : ils
 * fusionneraient « évacuer les gravats du local technique » et « évacuer les
 * gravats de la cour », qui partagent tout sauf l'essentiel. Le lieu, le
 * responsable et l'échéance participent à la décision — c'est ce qui distingue
 * un rapprochement d'une ressemblance.
 */
export function scoreCandidate(subject: MatchSubject, candidate: MatchCandidate): ProposalMatch {
  const reasons: MatchReason[] = []
  const overlap = subjectOverlap(subject.title, candidate.title)

  if (sameOwner(subject.owner, candidate.owner)) reasons.push('same_owner')
  if (subject.sourceReportId && subject.sourceReportId === candidate.sourceReportId) reasons.push('same_source')
  if (subject.due && candidate.due && normalize(subject.due) === normalize(candidate.due)) reasons.push('same_due_window')

  // Un titre STRICTEMENT identique une fois normalisé : le même fait, redit.
  if (normalize(subject.title) === normalize(candidate.title)) {
    return {
      status: 'matched', objectType: candidate.objectType, objectId: candidate.objectId,
      confidence: 1, reasons: ['same_subject', ...reasons],
    }
  }

  if (overlap < SEUIL_DOUTE) return { status: 'new' }
  reasons.push('same_subject')
  if (overlap >= 0.7) reasons.push('semantic_similarity')

  // Un mot de contenu que l'un porte et l'autre pas peut être le LIEU — « local
  // technique » contre « cour ». Tant qu'on ne sait pas lire un lieu, un écart
  // de vocabulaire interdit le rapprochement silencieux : dans le doute, on
  // demande à l'humain plutôt que de faire disparaître un fait.
  const ecart = distinctifs(subject.title, candidate.title).size
  const status = overlap >= SEUIL_MATCHED && ecart === 0 ? 'matched' : 'possible_duplicate'

  return { status, objectType: candidate.objectType, objectId: candidate.objectId, confidence: overlap, reasons }
}

/**
 * Le meilleur verdict parmi les faits déjà connus. On ne rend qu'UN candidat :
 * proposer trois rapprochements à un conducteur, c'est lui déléguer le travail
 * qu'on n'a pas su faire.
 */
export function matchProposal(subject: MatchSubject, candidates: MatchCandidate[]): ProposalMatch {
  let best: ProposalMatch = { status: 'new' }
  for (const c of candidates) {
    const m = scoreCandidate(subject, c)
    if (m.status === 'new') continue
    if (best.status === 'new' || m.confidence > best.confidence) best = m
  }
  return best
}
