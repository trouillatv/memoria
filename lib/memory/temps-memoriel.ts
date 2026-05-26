// Temps mémoriel — Sprint D, moitié 1 (Vincent 2026-05-27).
//
// UN SEUL langage humain pour le temps de la mémoire, partagé par toutes les
// surfaces. Déterministe : calculé depuis les champs techniques DÉJÀ existants
// (statuts, dates), ZÉRO IA, ZÉRO score, ZÉRO magie noire.
//
// RÈGLE DOCTRINALE STRICTE (anti sur-sémantisation, cf. retour Vincent) :
// la grammaire compte EXACTEMENT 4 états humains. Pas un de plus. Le test
// tests/doctrine/temps-memoriel-guard.test.ts le verrouille.
//
//   présent   → encore utile activement
//   sommeil   → mémoire conservée mais peu active (ancienne / expirée)
//   clos      → sujet traité humainement (résolu)
//   remplace  → une mémoire plus récente existe (supersédé)
//
// NB : « écarté » (dismissed = « c'était faux ») n'entre PAS dans la grammaire
// du temps : ce n'est pas un état de la mémoire vivante, c'est une suppression
// de bruit. Ces éléments ne s'affichent simplement plus.

export type MemoryState = 'present' | 'sommeil' | 'clos' | 'remplace'

/** Libellés humains — UNIQUE source de vérité du vocabulaire. Exactement 4. */
export const MEMORY_STATE_LABEL: Record<MemoryState, string> = {
  present: 'Présent',
  sommeil: 'En sommeil',
  clos: 'Clos',
  remplace: 'Remplacé',
}

/** Phrase de sens, descriptive, jamais évaluative. */
export const MEMORY_STATE_MEANING: Record<MemoryState, string> = {
  present: 'Encore utile activement.',
  sommeil: 'Mémoire conservée, mais peu active.',
  clos: 'Sujet traité.',
  remplace: 'Une mémoire plus récente existe.',
}

/**
 * Calcule l'état mémoriel d'un artefact à partir de ses champs techniques.
 * Priorité d'évaluation : remplacé > clos > sommeil > présent.
 *
 * Mapping (depuis l'existant, aucun nouveau champ requis) :
 *   - superseded                              → remplace
 *   - resolved                                → clos
 *   - stale | expired | expiresAt dépassé     → sommeil
 *   - sinon (active, dans sa fenêtre)          → présent
 *
 * Retourne null si l'élément ne doit pas être présenté du tout (ex. dismissed,
 * archived, deleted) — l'appelant ne l'affiche alors pas.
 */
export function memoryState(input: {
  status?: string | null
  expiresAt?: string | null
  now?: Date
}): MemoryState | null {
  const status = input.status ?? 'active'

  // Hors grammaire : ces états ne sont pas de la mémoire vivante à présenter.
  if (status === 'dismissed' || status === 'archived' || status === 'deleted') {
    return null
  }

  if (status === 'superseded') return 'remplace'
  if (status === 'resolved') return 'clos'

  const now = input.now ?? new Date()
  const expired = input.expiresAt != null && new Date(input.expiresAt).getTime() < now.getTime()
  if (status === 'stale' || status === 'expired' || expired) return 'sommeil'

  return 'present'
}
