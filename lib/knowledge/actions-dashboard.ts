import 'server-only'

// ── PILOTAGE DES ACTIONS — read model unique (Tranche 1) ─────────────────────
// getActionsDashboard compose TOUT ce que la page Actions affiche : 5 KPIs réels,
// liste enrichie, options de filtres. Fail-closed org (le service-role bypasse la
// RLS). Zéro nouveau modèle : « À confirmer » vient des propositions kind='action'
// (site_knowledge_proposals, mig 212) ; origine = provenance canonique (Slice 5) ;
// dernière activité = journal canonique (site_action_events, Slice 6B). Le renderer
// n'interroge aucune table.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { todayLocalIso } from '@/lib/time/local-date'
import type { DbSiteAction } from '@/types/db'
import { primaryProvenanceKind } from '@/lib/knowledge/action-provenance'
import { normalizeActionHistory, type RawActionEvent } from '@/lib/knowledge/action-history'
import {
  ACTION_STATUS_LABEL, latenessLabel, summarizeActions,
  type ActionDashboardItem, type ActionOrigin, type ActionsDashboardSummary, type ActionListStatus,
} from '@/lib/knowledge/actions-dashboard-model'

export interface ActionsDashboard {
  summary: ActionsDashboardSummary
  actions: ActionDashboardItem[]
  filters: {
    responsibles: string[]
    origins: ActionOrigin['type'][]
    statuses: ActionListStatus[]
  }
}

const EMPTY: ActionsDashboard = {
  summary: {
    aConfirmer: 0, proposalBreakdown: { deadline: 0, decision: 0, knowledge: 0, stakeholder: 0, vigilance: 0 },
    actives: 0, activesBreakdown: { open: 0, planned: 0 }, enRetard: 0, termineesSansPreuve: 0, terminees: 0, total: 0,
  },
  actions: [], filters: { responsibles: [], origins: [], statuses: [] },
}

const LONG = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long' })
const longDate = (iso: string | null | undefined): string | null => (iso ? LONG.format(new Date(iso)) : null)
const SHORT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: '2-digit', month: '2-digit' })
const shortDate = (iso: string | null | undefined): string | null => (iso ? SHORT.format(new Date(iso)) : null)

export async function getActionsDashboard(opts?: { siteId?: string }): Promise<ActionsDashboard> {
  const orgId = await getOrgId()
  if (!orgId) return EMPTY
  const db = createAdminClient()

  // Sites de l'organisation (garde tenant).
  let sitesQ = db.from('sites').select('id, name').is('deleted_at', null).eq('organization_id', orgId)
  if (opts?.siteId) sitesQ = sitesQ.eq('id', opts.siteId)
  const { data: siteRows } = await sitesQ
  const sites = (siteRows ?? []) as Array<{ id: string; name: string }>
  if (sites.length === 0) return EMPTY
  const siteIds = sites.map((s) => s.id)
  const siteName = new Map(sites.map((s) => [s.id, s.name]))

  // Actions (tous statuts), plus récentes d'abord.
  const { data: actRows } = await db.from('site_actions').select('*').in('site_id', siteIds).order('created_at', { ascending: false })
  const actions = (actRows ?? []) as DbSiteAction[]
  const actionIds = actions.map((a) => a.id)

  // « À confirmer » = propositions encore proposées, comptées par nature.
  let propQ = db.from('site_knowledge_proposals').select('kind').eq('organization_id', orgId).eq('status', 'proposed')
  if (opts?.siteId) propQ = propQ.eq('site_id', opts.siteId)
  const { data: propRows } = await propQ
  const propByKind = { action: 0, deadline: 0, decision: 0, knowledge: 0, stakeholder: 0, vigilance: 0 } as Record<string, number>
  for (const p of (propRows ?? []) as Array<{ kind: string }>) propByKind[p.kind] = (propByKind[p.kind] ?? 0) + 1

  // ── Résolutions batchées ──
  // Responsable = la personne (contact du casting). assigned_to (texte) en repli.
  const contactIds = [...new Set(actions.map((a) => a.assigned_contact_id).filter((v): v is string => !!v))]
  const contactById = new Map<string, { name: string; fonction: string | null }>()
  if (contactIds.length) {
    const { data: cs } = await db.from('company_contacts').select('id, full_name, function').in('id', contactIds)
    for (const c of (cs ?? []) as Array<{ id: string; full_name: string | null; function: string | null }>)
      contactById.set(c.id, { name: c.full_name ?? '', fonction: c.function })
  }

  // Origine (provenance canonique). Batché : réserves, reports, sujets, captures→reports.
  const reserveIds = [...new Set(actions.map((a) => a.reserve_id).filter((v): v is string => !!v))]
  const subjectIds = [...new Set(actions.map((a) => a.subject_id).filter((v): v is string => !!v))]
  const captureIds = [...new Set(actions.map((a) => a.source_capture_id).filter((v): v is string => !!v))]
  const reportIds = new Set(actions.map((a) => a.report_id).filter((v): v is string => !!v))

  const captureReport = new Map<string, string>()
  const captureBody = new Map<string, string>()
  if (captureIds.length) {
    const { data: caps } = await db.from('visit_capture').select('id, report_id, body').in('id', captureIds).in('site_id', siteIds)
    for (const c of (caps ?? []) as Array<{ id: string; report_id: string | null; body: string | null }>) {
      if (c.report_id) { captureReport.set(c.id, c.report_id); reportIds.add(c.report_id) }
      if (c.body?.trim()) captureBody.set(c.id, c.body.trim())
    }
  }

  const reserveById = new Map<string, string>()
  if (reserveIds.length) {
    const { data: rs } = await db.from('site_reserve').select('id, label').in('id', reserveIds).in('site_id', siteIds)
    for (const r of (rs ?? []) as Array<{ id: string; label: string }>) reserveById.set(r.id, r.label)
  }
  const subjectById = new Map<string, string>()
  if (subjectIds.length) {
    const { data: ss } = await db.from('subjects').select('id, name').in('id', subjectIds).in('site_id', siteIds)
    for (const s of (ss ?? []) as Array<{ id: string; name: string }>) subjectById.set(s.id, s.name)
  }
  const reportById = new Map<string, { origin: string | null; title: string | null; date: string | null }>()
  if (reportIds.size) {
    const { data: reps } = await db.from('site_reports').select('id, origin, title, started_at, created_at').in('id', [...reportIds]).in('site_id', siteIds)
    for (const r of (reps ?? []) as Array<{ id: string; origin: string | null; title: string | null; started_at: string | null; created_at: string }>)
      reportById.set(r.id, { origin: r.origin, title: r.title, date: r.started_at ?? r.created_at })
  }

  // Dernière activité = dernier événement du journal (réutilise le module canonique).
  const latestEvent = new Map<string, RawActionEvent>()
  if (actionIds.length) {
    const { data: evs } = await db.from('site_action_events')
      .select('id, action_id, kind, occurred_at, actor_label, before_value, after_value, reason')
      .in('action_id', actionIds).order('occurred_at', { ascending: false })
    for (const e of (evs ?? []) as Array<RawActionEvent & { action_id: string }>)
      if (!latestEvent.has(e.action_id)) latestEvent.set(e.action_id, e)
  }

  // Origine en PROSE : « la ligne raconte pourquoi l'action existe ». Data déjà
  // chargée (date du report, libellé de réserve) — aucune requête en plus.
  function originOf(a: DbSiteAction): ActionOrigin | null {
    const kind = primaryProvenanceKind({ reserveId: a.reserve_id, reportId: a.report_id, sourceCaptureId: a.source_capture_id, subjectId: a.subject_id })
    if (kind === 'reserve' && a.reserve_id) {
      const label = reserveById.get(a.reserve_id)
      return {
        type: 'reserve',
        label: label ? `Suite à la réserve ${label}` : 'Suite à une réserve',
        short: label ? `Réserve ${label}` : 'Réserve',
        href: `/sites/${a.site_id}/reserves`,
      }
    }
    const repId = kind === 'report' ? a.report_id : kind === 'capture' ? (a.source_capture_id ? captureReport.get(a.source_capture_id) ?? null : null) : null
    if ((kind === 'report' || kind === 'capture') && repId) {
      const r = reportById.get(repId)
      const type: ActionOrigin['type'] = r?.origin ? 'visite' : 'reunion'
      const l = longDate(r?.date)
      const s = shortDate(r?.date)
      const label = type === 'visite'
        ? (l ? `Issue de la visite du ${l}` : 'Issue d’une visite')
        : (l ? `Décidée en réunion du ${l}` : 'Issue d’une réunion')
      const base = r?.title?.trim() || (type === 'visite' ? 'Visite' : 'Réunion')
      return { type, label, short: s ? `${base} · ${s}` : base, href: `/meetings/${repId}` }
    }
    if (kind === 'subject' && a.subject_id) {
      const name = subjectById.get(a.subject_id)
      return {
        type: 'sujet',
        label: name ? `Rattachée au sujet « ${name} »` : 'Rattachée à un sujet',
        short: name ? `Sujet · ${name}` : 'Sujet',
        href: `/sites/${a.site_id}/subjects/${a.subject_id}`,
      }
    }
    return null
  }

  const today = todayLocalIso()
  const items: ActionDashboardItem[] = actions.map((a) => {
    const contact = a.assigned_contact_id ? contactById.get(a.assigned_contact_id) : null
    const responsibleName = contact?.name || (a.assigned_to?.trim() || null)
    const responsibleSub = contact?.fonction ?? null
    const ev = latestEvent.get(a.id)
    const lastActivity = ev ? (() => { const [n] = normalizeActionHistory([ev]); return n ? { label: n.line, occurredAt: n.occurredAt } : null })() : null
    const due = a.due_date ? a.due_date.slice(0, 10) : null
    return {
      id: a.id, siteId: a.site_id, siteName: siteName.get(a.site_id) ?? '—',
      title: a.title, description: a.body,
      status: a.status, statusLabel: ACTION_STATUS_LABEL[a.status] ?? a.status,
      responsibleName, responsibleSub,
      dueDate: due, dueDateStatus: a.due_date_status,
      lateness: latenessLabel({ status: a.status, dueDate: due }, today),
      origin: originOf(a),
      // Le fait observé (capture déclencheuse), tronqué pour la ligne.
      observed: a.source_capture_id ? (captureBody.get(a.source_capture_id)?.slice(0, 140) ?? null) : null,
      lastActivity,
      hasClosureTrace: !!(a.completed_photo_path || a.completed_comment?.trim()),
      href: `/sites/${a.site_id}?action=${a.id}&action_source=actions`,
    }
  })

  const summary = summarizeActions(items, today, {
    aConfirmer: propByKind.action ?? 0,
    breakdown: {
      deadline: propByKind.deadline ?? 0, decision: propByKind.decision ?? 0,
      knowledge: propByKind.knowledge ?? 0, stakeholder: propByKind.stakeholder ?? 0, vigilance: propByKind.vigilance ?? 0,
    },
  })

  const responsibles = [...new Set(items.map((i) => i.responsibleName).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))
  const origins = [...new Set(items.map((i) => i.origin?.type).filter((v): v is ActionOrigin['type'] => !!v))]
  const statuses = [...new Set(items.map((i) => i.status))] as ActionListStatus[]

  return { summary, actions: items, filters: { responsibles, origins, statuses } }
}
