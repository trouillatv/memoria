// PL2 — les fermetures de site, côté CALCUL. Pur, client-safe, testé.
//
// Ce module ne fait que RÉPONDRE À LA QUESTION « ce lieu est-il fermé ce
// jour-là, et pourquoi ? ». Il ne déplace rien, n'annule rien, ne décide rien :
// PL3 confrontera ces fermetures aux occurrences de `lib/planning/projection.ts`
// pour SIGNALER un conflit, que l'humain tranchera.
//
// On renvoie LA FERMETURE, jamais un booléen : PL3 aura besoin du pourquoi
// (raison, motif, geste proposé par défaut), pas d'un oui/non.

export type ClosureReasonKind =
  | 'holiday'
  | 'client'
  | 'maintenance'
  | 'inventory'
  | 'exceptional'
  | 'other'

export type ClosureResolution = 'none' | 'move' | 'cancel' | 'keep'

/** Le strict nécessaire au calcul (un `DbSiteClosure` est accepté tel quel). */
export interface ProjectableClosure {
  id: string
  siteId: string
  reasonKind: ClosureReasonKind
  reason: string | null
  /** yyyy-mm-dd, inclus */
  startsOn: string
  /** yyyy-mm-dd, inclus — une fermeture d'un jour a startsOn === endsOn */
  endsOn: string
  defaultResolution: ClosureResolution
}

/**
 * RÈGLE DE CHEVAUCHEMENT — fixée ici une fois pour toutes, pour que PL3 et la
 * vue mois disent la même chose :
 *
 * Quand plusieurs fermetures couvrent le même jour, la fermeture APPLICABLE est
 *   1. celle qui a commencé le plus tôt (elle est déjà en vigueur) ;
 *   2. à égalité, la plus CONTRAIGNANTE (celle qui finit le plus tard) ;
 *   3. à égalité encore, la plus petite par id (départage total, donc stable).
 *
 * Le résultat est donc TOUJOURS déterministe — jamais « celle que la base a
 * renvoyée en premier ».
 */
function moreApplicable(a: ProjectableClosure, b: ProjectableClosure): ProjectableClosure {
  if (a.startsOn !== b.startsOn) return a.startsOn < b.startsOn ? a : b
  if (a.endsOn !== b.endsOn) return a.endsOn > b.endsOn ? a : b
  return a.id <= b.id ? a : b
}

/** Bornes INCLUSES : le premier et le dernier jour sont fermés. */
function covers(c: ProjectableClosure, dateIso: string): boolean {
  return c.startsOn <= dateIso && dateIso <= c.endsOn
}

/**
 * La fermeture applicable ce jour-là, ou `null`. Renvoie l'OBJET (PL3 a besoin
 * du pourquoi), jamais un booléen.
 *
 * Les fermetures retirées (`deleted_at`) ne doivent pas arriver ici : la couche
 * `lib/db/site-closures.ts` les filtre à la lecture. Ce module ne connaît que
 * des fermetures actives.
 */
export function findClosureForDate(
  closures: ProjectableClosure[],
  dateIso: string,
): ProjectableClosure | null {
  let best: ProjectableClosure | null = null
  for (const c of closures) {
    if (!covers(c, dateIso)) continue
    best = best === null ? c : moreApplicable(best, c)
  }
  return best
}

/**
 * Projette les fermetures sur [from, to] : pour chaque jour FERMÉ, la fermeture
 * applicable. Un jour ouvert n'a pas de clé — l'absence est l'état normal.
 *
 * Le pendant exact de `projectOccurrences` (PL1) : même forme, même pureté.
 * PL3 croisera les deux, jour par jour, pour lever un conflit.
 */
export function projectClosures(params: {
  closures: ProjectableClosure[]
  /** yyyy-mm-dd inclus */
  from: string
  /** yyyy-mm-dd inclus */
  to: string
}): Record<string, ProjectableClosure> {
  const { closures, from, to } = params
  if (!from || !to || from > to) return {}

  const out: Record<string, ProjectableClosure> = {}
  const start = new Date(`${from}T00:00:00.000Z`).getTime()
  const end = new Date(`${to}T00:00:00.000Z`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return {}

  for (let t = start; t <= end; t += 86_400_000) {
    const dateIso = new Date(t).toISOString().slice(0, 10)
    const closure = findClosureForDate(closures, dateIso)
    if (closure) out[dateIso] = closure
  }
  return out
}

/** Libellés FR — le produit parle de fermetures, pas de codes. */
export const CLOSURE_REASON_FR: Record<ClosureReasonKind, string> = {
  holiday: 'Jour férié',
  client: 'Fermeture du client',
  maintenance: 'Travaux / entretien',
  inventory: 'Inventaire',
  exceptional: 'Fermeture exceptionnelle',
  other: 'Autre',
}
