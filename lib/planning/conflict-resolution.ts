// PL3b — RÉSOUDRE le conflit « site fermé, prestation prévue ».
//
// PL3a CONSTATAIT. Il ne proposait rien : « le site est fermé le 15, une
// prestation est prévue ». Guillaume voyait le problème et devait aller le
// corriger ailleurs, à la main, en devinant lui-même quelle date était libre.
//
// PL3b lui donne les gestes — et UN SEUL invariant les gouverne :
//
//   ⚖️  MEMORIA NE DÉCIDE JAMAIS. Il propose des dates, il ne les applique pas.
//       Chaque geste est un choix humain, et chaque choix est TRACÉ : la
//       décision se relit un an plus tard (« pourquoi on est passé le 16 ? »).
//
// Cinq gestes, pas un de plus :
//   • déplacer AVANT   — le dernier jour ouvert avant la fermeture ;
//   • déplacer APRÈS   — le premier jour ouvert après ;
//   • une AUTRE date   — il choisit, on vérifie qu'elle est ouverte ;
//   • MAINTENIR        — « on y va quand même » (un chantier peut être fermé au
//                        public et ouvert au prestataire) ;
//   • ANNULER          — la prestation ne se fera pas.
//
// Pur : aucune base, aucun réseau. Ce sont les règles, pas la plomberie.

import { findClosureForDate, type ProjectableClosure } from './closures'

export type ConflictDecision = 'moved' | 'kept' | 'cancelled'

/** Ce qu'on écrit quand l'humain a tranché. */
export interface ResolutionRecord {
  interventionId: string
  closureId: string
  decision: ConflictDecision
  /** La date choisie, si on a déplacé. */
  movedTo: string | null
}

const DAY_MS = 86_400_000

function shift(dateIso: string, days: number): string {
  const t = new Date(`${dateIso}T00:00:00.000Z`).getTime()
  if (Number.isNaN(t)) return dateIso
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10)
}

/** Ce jour-là, le chantier est-il fermé ? */
export function isClosed(closures: ProjectableClosure[], dateIso: string): boolean {
  return findClosureForDate(closures, dateIso) !== null
}

/**
 * Le premier jour OUVERT dans une direction.
 *
 * `direction = -1` → avant · `+1` → après. On avance jour par jour, jusqu'à
 * `maxDays`. Au-delà, on renonce : proposer une date à trois semaines de là
 * n'aiderait personne, et une fermeture annuelle ne se règle pas par un
 * déplacement.
 *
 * Le week-end N'EST PAS un obstacle : Guillaume travaille le samedi et le
 * dimanche (son planning le prouve). Seule une FERMETURE DÉCLARÉE ferme un jour.
 */
export function nextOpenDay(
  closures: ProjectableClosure[],
  fromIso: string,
  direction: -1 | 1,
  maxDays = 14,
): string | null {
  for (let i = 1; i <= maxDays; i += 1) {
    const candidate = shift(fromIso, direction * i)
    if (!isClosed(closures, candidate)) return candidate
  }
  return null
}

export interface ResolutionOption {
  kind: 'move_before' | 'move_after'
  date: string
  /** Combien de jours d'écart — « la veille », « 3 jours plus tard ». */
  gapDays: number
}

/**
 * Les deux dates proposées, quand elles existent.
 *
 * On ne propose JAMAIS une date fermée — ce serait remplacer un conflit par un
 * autre. Et on ne propose rien quand il n'y a rien à proposer : un écran qui
 * offre un geste impossible est pire qu'un écran qui n'offre rien.
 */
export function resolutionOptions(
  closures: ProjectableClosure[],
  conflictDate: string,
  maxDays = 14,
): ResolutionOption[] {
  const out: ResolutionOption[] = []

  const before = nextOpenDay(closures, conflictDate, -1, maxDays)
  if (before) {
    out.push({
      kind: 'move_before',
      date: before,
      gapDays: Math.round(
        (new Date(`${conflictDate}T00:00:00Z`).getTime() -
          new Date(`${before}T00:00:00Z`).getTime()) /
          DAY_MS,
      ),
    })
  }

  const after = nextOpenDay(closures, conflictDate, 1, maxDays)
  if (after) {
    out.push({
      kind: 'move_after',
      date: after,
      gapDays: Math.round(
        (new Date(`${after}T00:00:00Z`).getTime() -
          new Date(`${conflictDate}T00:00:00Z`).getTime()) /
          DAY_MS,
      ),
    })
  }

  return out
}

/** « la veille », « le lendemain », « 3 jours avant » — jamais « J-3 ». */
export function gapFr(gapDays: number, direction: 'before' | 'after'): string {
  if (gapDays === 1) return direction === 'before' ? 'la veille' : 'le lendemain'
  return direction === 'before' ? `${gapDays} jours avant` : `${gapDays} jours après`
}

/**
 * Une date choisie à la main est-elle acceptable ?
 *
 * Deux refus, et ils sont dits :
 *   • une date FERMÉE → on remplacerait un conflit par un autre ;
 *   • le passé → on ne replanifie pas hier.
 */
export function validateChosenDate(
  closures: ProjectableClosure[],
  dateIso: string,
  todayIso: string,
): { ok: true } | { ok: false; reason: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return { ok: false, reason: 'Date invalide' }
  if (dateIso < todayIso) return { ok: false, reason: 'Cette date est déjà passée' }

  const closure = findClosureForDate(closures, dateIso)
  if (closure) {
    return {
      ok: false,
      reason: closure.reason?.trim()
        ? `Le chantier est aussi fermé ce jour-là — ${closure.reason.trim()}`
        : 'Le chantier est aussi fermé ce jour-là',
    }
  }

  return { ok: true }
}

/** Ce que la décision raconte, un an plus tard. */
export const DECISION_FR: Record<ConflictDecision, string> = {
  moved: 'Déplacée',
  kept: 'Maintenue malgré la fermeture',
  cancelled: 'Annulée',
}
