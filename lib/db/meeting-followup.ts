// Sprint 3 — Suivi de la réunion précédente.
//
// 100% DÉTERMINISTE depuis site_actions (jamais de LLM, jamais d'interprétation,
// zéro hallucination). Transforme le PV statique en PV de pilotage : ce qui a
// été clôturé, ce qui reste ouvert, ce qui est en retard, ce qui n'a pas de
// responsable. Wording centré sur l'ACTION, jamais sur la personne (anti-RH).
//
// Définitions (validées Vincent 2026-06-19) :
//   - en retard      = action ouverte/planned avec due_date < aujourd'hui
//   - sans responsable = assigned_to vide
//   - clôturée       = status='done' avec done_at >= date de la réunion précédente

import { createAdminClient } from '@/lib/supabase/admin'
import { listSiteActionsBySite } from '@/lib/db/site-actions'

export interface MeetingFollowup {
  hasPrevious: boolean
  previousMeetingDate: string | null
  closed: number
  open: number
  overdue: number
  withoutOwner: number
  /** Ouvertes en retard ou anciennes, triées par criticité. */
  criticalPoints: { label: string; detail: string }[]
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

function daysOverdue(dueIso: string): number {
  const ms = Date.now() - new Date(dueIso).getTime()
  return Math.floor(ms / 86_400_000)
}

/** Trouve la date de la réunion précédente du même site (avant ce report). */
async function previousMeetingDate(siteId: string, beforeIso: string, exceptId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('site_reports')
    .select('created_at')
    .eq('site_id', siteId)
    .lt('created_at', beforeIso)
    .neq('id', exceptId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { created_at: string } | null)?.created_at ?? null
}

/**
 * Calcule le suivi pour une réunion. Renvoie null si la réunion n'est pas
 * rattachée à un site (réunion contrat : hors périmètre MVP de ce bloc).
 */
export async function getMeetingFollowup(report: {
  id: string
  site_id: string | null
  created_at: string
}): Promise<MeetingFollowup | null> {
  if (!report.site_id) return null

  const [prevDate, actions] = await Promise.all([
    previousMeetingDate(report.site_id, report.created_at, report.id),
    listSiteActionsBySite(report.site_id),
  ])

  const today = todayIso()
  const openActions = actions.filter((a) => a.status === 'open' || a.status === 'planned')
  const overdueActions = openActions.filter((a) => a.due_date != null && a.due_date < today)
  const withoutOwner = openActions.filter((a) => !(a.assigned_to ?? '').trim()).length

  // Clôturées depuis la réunion précédente (ou toutes les done si pas d'historique).
  const closed = actions.filter(
    (a) => a.status === 'done' && a.done_at != null && (prevDate == null || a.done_at >= prevDate),
  ).length

  // Points critiques : en retard d'abord (par jours de retard), puis les
  // ouvertes anciennes (> 7 j). Wording centré action, pas personne.
  const criticalPoints = openActions
    .map((a) => {
      const owner = (a.assigned_to ?? '').trim()
      const label = owner ? `${a.title} (${owner})` : a.title
      if (a.due_date != null && a.due_date < today) {
        return { label, detail: `échéance dépassée de ${daysOverdue(a.due_date)} jours`, sort: 1000 + daysOverdue(a.due_date) }
      }
      const age = daysSince(a.created_at)
      if (age > 7) return { label, detail: `ouvert depuis ${age} jours`, sort: age }
      return null
    })
    .filter((x): x is { label: string; detail: string; sort: number } => x !== null)
    .sort((a, b) => b.sort - a.sort)
    .slice(0, 5)
    .map(({ label, detail }) => ({ label, detail }))

  return {
    hasPrevious: prevDate != null,
    previousMeetingDate: prevDate,
    closed,
    open: openActions.length,
    overdue: overdueActions.length,
    withoutOwner,
    criticalPoints,
  }
}

/** Rendu texte du bloc pour une section de PV (source de vérité = sections jsonb). */
export function formatFollowupForPv(f: MeetingFollowup): string {
  const lines: string[] = []
  lines.push(`Clôturées : ${f.closed} · Ouvertes : ${f.open} · En retard : ${f.overdue} · Sans responsable : ${f.withoutOwner}`)
  if (f.criticalPoints.length > 0) {
    lines.push('')
    lines.push('Points critiques :')
    for (const p of f.criticalPoints) lines.push(`- ${p.label} — ${p.detail}`)
  }
  if (!f.hasPrevious) {
    lines.push('')
    lines.push('(Première réunion du site — pas d\'historique antérieur.)')
  }
  return lines.join('\n')
}
