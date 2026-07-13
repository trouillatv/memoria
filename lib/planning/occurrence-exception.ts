// L'EXCEPTION PONCTUELLE — « ce jour-là, on déroge ».
//
// Une intervention issue d'un roulement peut être modifiée POUR CE JOUR
// SEULEMENT : autre équipe, autre horaire, autre date, ou annulée. Le roulement,
// lui, N'EST JAMAIS TOUCHÉ — c'est l'invariant qui rend la dérogation sûre.
//
// Deux choses doivent alors être vraies, et c'est ce module qui les garantit :
//
//   1. L'exception SE VOIT. Une occurrence qui dévie en silence ferait mentir la
//      grille : Guillaume lirait « équipe Nord » dans le roulement et verrait
//      l'équipe Sud sur le terrain, sans savoir pourquoi.
//
//   2. L'exception SE DÉFAIT. « Revenir au roulement » restaure exactement ce
//      que le rythme prescrit — pas ce qu'on croit se rappeler.
//
// Pur : on compare une occurrence à son rythme. Aucune base, aucun réseau.

import { projectOccurrences, type ProjectableTemplate } from './projection'

/** Ce qu'il faut savoir d'une occurrence pour la comparer à son rythme. */
export interface OccurrenceView {
  /** yyyy-mm-dd */
  scheduledFor: string
  status: string
  assignedTeamId: string | null
  /** 'HH:MM' — déjà extraite de l'horodatage par l'appelant. */
  startHHMM: string | null
  endHHMM: string | null
}

export type DeviationKind = 'date' | 'team' | 'time' | 'cancelled'

export interface Deviation {
  kind: DeviationKind
  /** « Jour déplacé », « Équipe changée »… — prêt à afficher. */
  label: string
}

const LABEL: Record<DeviationKind, string> = {
  date: 'Jour déplacé',
  team: 'Équipe changée',
  time: 'Horaire modifié',
  cancelled: 'Annulée ce jour',
}

/**
 * En quoi cette occurrence dévie-t-elle de son rythme ?
 *
 * Liste vide = conforme : elle fait exactement ce que le roulement prescrit.
 * On ne signale que des FAITS comparables — jamais une interprétation.
 */
export function detectDeviations(occ: OccurrenceView, tpl: ProjectableTemplate): Deviation[] {
  const out: Deviation[] = []

  // Annulée : le rythme prévoyait ce jour, l'humain a dit non.
  if (occ.status === 'skipped') out.push({ kind: 'cancelled', label: LABEL.cancelled })

  // Jour déplacé : la date actuelle n'est PAS une date que le rythme produit.
  // C'est le moteur de projection qui répond — le même que la génération et
  // l'aperçu. Une seule vérité.
  const prescribed = projectOccurrences({
    templates: [tpl],
    from: occ.scheduledFor,
    to: occ.scheduledFor,
  })
  if (prescribed.length === 0) out.push({ kind: 'date', label: LABEL.date })

  // Équipe changée : seulement si le rythme en prescrit une.
  const tplTeam = (tpl as { assigned_team_id?: string | null }).assigned_team_id ?? null
  if (tplTeam && occ.assignedTeamId && occ.assignedTeamId !== tplTeam) {
    out.push({ kind: 'team', label: LABEL.team })
  }

  // Horaire modifié : seulement si le rythme en prescrit un.
  if (tpl.planned_start_hhmm && occ.startHHMM && occ.startHHMM !== tpl.planned_start_hhmm) {
    out.push({ kind: 'time', label: LABEL.time })
  } else if (tpl.planned_end_hhmm && occ.endHHMM && occ.endHHMM !== tpl.planned_end_hhmm) {
    out.push({ kind: 'time', label: LABEL.time })
  }

  return out
}

const DAY_MS = 86_400_000

function shift(dateIso: string, days: number): string {
  return new Date(new Date(`${dateIso}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

/**
 * LE JOUR QUE LE RYTHME PRESCRIT, le plus proche d'une date donnée.
 *
 * C'est la cible de « Revenir au roulement » quand le jour a été déplacé. On
 * cherche à ±7 jours : au-delà, « revenir » ne veut plus rien dire — l'occurrence
 * a changé de semaine de cycle, et on préfère le DIRE que deviner.
 *
 * À égalité de distance, le jour PASSÉ le plus proche gagne : une occurrence
 * déplacée l'a presque toujours été vers l'avant.
 */
export function prescribedDateNear(tpl: ProjectableTemplate, aroundIso: string): string | null {
  const dates = projectOccurrences({
    templates: [tpl],
    from: shift(aroundIso, -7),
    to: shift(aroundIso, 7),
  }).map((o) => o.scheduledFor)

  if (dates.length === 0) return null

  const t = new Date(`${aroundIso}T00:00:00.000Z`).getTime()
  return dates.reduce((best, d) => {
    const dd = Math.abs(new Date(`${d}T00:00:00.000Z`).getTime() - t)
    const bd = Math.abs(new Date(`${best}T00:00:00.000Z`).getTime() - t)
    if (dd < bd) return d
    if (dd === bd && d < best) return d
    return best
  })
}

/** 'HH:MM' depuis un horodatage — l'heure telle que la grille l'affiche. */
export function hhmmOf(timestamptz: string | null): string | null {
  if (!timestamptz) return null
  const d = new Date(timestamptz)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(11, 16)
}
