// B1 — helpers PURS pour les résonances déterministes document ↔ terrain
// (approche α). Pas de `server-only`, pas d'I/O, pas d'IA. Testables hors
// runtime serveur. Le module server-only `./resonances.ts` les réutilise.
//
// Doctrine B1 : déterministe, explicable, faible coût, stable. Bigrammes
// FR (mots significatifs ≥3 chars, hors stopwords). Faible couverture par
// design : on préfère 0 résonance que des résonances absurdes.

const STOPWORDS_FR = new Set<string>([
  'le','la','les','un','une','des','du','de','d','l','et','ou','où','en','à','au','aux',
  'dans','sur','sous','par','pour','avec','sans','ce','cet','cette','ces','se','sa','son','ses',
  'mon','ton','notre','votre','leur','leurs','est','sont','etre','être','ete','été','avoir','ont',
  'a','ai','as','ne','pas','plus','que','qui','quoi','dont','y','si','ainsi','aussi','tout','tous',
  'toute','toutes','autre','autres','tres','très','mais','donc','car','puis','déjà','deja',
  'depuis','jusqu','jusque','vers','chez','entre','contre','selon','pendant','apres','après','avant',
])

/** Normalise un mot : lowercase + suppression des diacritiques. Stable et
 *  déterministe (pas de locale-specific surprise). */
export function normalizeWord(w: string): string {
  return w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Tokenise en mots significatifs : ≥2 caractères, hors stopwords FR.
 *  Le seuil bas (2) accepte les sigles métier (« PC », « RH ») cités par
 *  Vincent comme exemples de bigrammes pertinents (« PC sécurité »). Les
 *  2-char inutiles (de, le, du, en, etc.) sont déjà capturés par
 *  STOPWORDS_FR. Le vrai filtre anti-bruit reste le bigramme : un mot
 *  isolé n'a jamais valeur de résonance. */
export function significantWords(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalizeWord)
    .filter((w) => w.length >= 2 && !STOPWORDS_FR.has(w))
}

/** Ensemble de bigrammes (paires de mots significatifs consécutifs). */
export function bigramsOf(text: string): Set<string> {
  const words = significantWords(text)
  const bg = new Set<string>()
  for (let i = 0; i < words.length - 1; i++) {
    bg.add(`${words[i]} ${words[i + 1]}`)
  }
  return bg
}

/**
 * Bigrammes communs entre deux textes — coeur du matching scénario 2
 * (procédure ↔ note terrain). Déterministe, ordre stable (tri alpha).
 * Couverture faible volontaire : il faut au moins 2 mots significatifs
 * consécutifs partagés (ex. « eau javel », « pc securite ») — un mot
 * isolé ne suffit pas (anti faux-lien sémantique).
 */
export function findCommonBigrams(a: string, b: string): string[] {
  const sa = bigramsOf(a)
  const sb = bigramsOf(b)
  const common: string[] = []
  for (const bg of sb) if (sa.has(bg)) common.push(bg)
  common.sort()
  return common
}

// Format français court « 20 mai » en zone Nouméa. Délégué au helper
// centralisé `lib/time/local-date.ts` (NETO_TIMEZONE='Pacific/Noumea').
// Évite la fuite UTC silencieuse : une trace créée à 09h Nouméa = 22h UTC
// la veille → afficher la date UTC serait un jour trop tôt.
export { frDayMonthLocal as frDayMonth } from '@/lib/time/local-date'

// ---------------------------------------------------------------------------
// Constantes B1 (paramètres internes, jamais doctrine)
// ---------------------------------------------------------------------------

/** Types de documents acceptés par l'algorithme B1. Filtre AND avec
 *  `document_links` (cf. spec §6.5). Juridique exclu (cf. raffinement
 *  Vincent : litige/contrat/avenant/facture → prudence ultra-stricte,
 *  hors B1). */
export const B1_DOC_TYPES_ACCESS = ['plan_acces', 'securite'] as const
export const B1_DOC_TYPES_PROCEDURE = ['procedure', 'protocole'] as const

/** Visibilités acceptées en source d'une résonance site : opérationnel /
 *  terrain (les surfaces site sont vues par field/operations). Les docs
 *  admin_only/manager-only NE produisent PAS de résonance site (défense
 *  en profondeur : filtré à l'indexation). */
export const B1_VISIBILITY_ALLOWED = ['operations', 'field'] as const

/** Plafond par site (anti-bruit, raffinement Vincent). */
export const B1_MAX_PER_SITE = 3

/** Durée de vie d'une résonance B1 (re-validation à 30 j). */
export const B1_EXPIRE_DAYS = 30

/** Algorithme namespacé pour mesure / dismiss / future migration.
 *  v2 (Vincent 2026-05-20) : ajout dedup per-trace pour éviter le
 *  doublon fonctionnel (2 docs proches → 1 seul fragment par (site,
 *  trace), last-write-wins). */
export const B1_ALGO_ACCESS = 'b1_doc_access_v2'
export const B1_ALGO_PROCEDURE = 'b1_doc_procedure_v2'
