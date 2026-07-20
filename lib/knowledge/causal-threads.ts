import 'server-only'

// ── MÉMOIRE CAUSALE — read model serveur ─────────────────────────────────────
// Assemble les « fils causals par engagement » en suivant UNIQUEMENT les liens
// réels du chantier. Fail-closed org. Réutilise les objets existants (actions,
// décisions, réserves, reports) — aucune nouvelle table, aucune inférence
// temporelle. Toute la doctrine des relations vit dans causal-threads-model
// (pur, testé) ; ici on ne fait que RÉSOUDRE les parts et composer.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { actionStatusLabel } from '@/lib/knowledge/action-fiche'
import { assembleThread, type CausalThread, type CausalNode } from '@/lib/knowledge/causal-threads-model'

const DATE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'short' })
const frShort = (iso: string | null | undefined): string | null => (iso ? DATE.format(new Date(iso)) : null)

export async function getSiteCausalThreads(siteId: string): Promise<CausalThread[] | null> {
  const orgId = await getOrgId()
  if (!orgId) return null
  const db = createAdminClient()
  const { data: site } = await db.from('sites').select('id, organization_id').eq('id', siteId).maybeSingle()
  if (!site || (site as { organization_id: string | null }).organization_id !== orgId) return null

  const { data: actRows } = await db.from('site_actions')
    .select('id, title, status, done_at, report_id, reserve_id')
    .eq('site_id', siteId).neq('status', 'cancelled').order('created_at', { ascending: true })
  const actions = (actRows ?? []) as Array<{ id: string; title: string; status: 'open' | 'planned' | 'done'; done_at: string | null; report_id: string | null; reserve_id: string | null }>
  if (actions.length === 0) return []
  const actionIds = actions.map((a) => a.id)

  // Décisions dont ces actions DÉCOULENT (reverse-lookup site_decisions.action_id).
  const { data: decRows } = await db.from('site_decisions')
    .select('id, titre, report_id, action_id').eq('site_id', siteId).in('action_id', actionIds)
  const decByAction = new Map<string, { id: string; titre: string; reportId: string | null }>()
  for (const d of (decRows ?? []) as Array<{ id: string; titre: string; report_id: string | null; action_id: string | null }>) {
    if (d.action_id) decByAction.set(d.action_id, { id: d.id, titre: d.titre, reportId: d.report_id })
  }

  // Reports (réunions/visites) : décisions + origines d'action. Scopés au chantier.
  const reportIds = new Set<string>()
  for (const a of actions) if (a.report_id) reportIds.add(a.report_id)
  for (const d of decByAction.values()) if (d.reportId) reportIds.add(d.reportId)
  const reportById = new Map<string, { origin: string | null; title: string | null; date: string | null }>()
  if (reportIds.size) {
    const { data: reps } = await db.from('site_reports').select('id, origin, title, started_at, created_at').in('id', [...reportIds]).eq('site_id', siteId)
    for (const r of (reps ?? []) as Array<{ id: string; origin: string | null; title: string | null; started_at: string | null; created_at: string }>)
      reportById.set(r.id, { origin: r.origin, title: r.title, date: r.started_at ?? r.created_at })
  }

  // Réserves CONCERNÉES par les actions (lien, jamais cause).
  const reserveIds = [...new Set(actions.map((a) => a.reserve_id).filter((v): v is string => !!v))]
  const reserveById = new Map<string, { label: string; liftedAt: string | null }>()
  if (reserveIds.length) {
    const { data: rs } = await db.from('site_reserve').select('id, label, lifted_at').in('id', reserveIds).eq('site_id', siteId)
    for (const r of (rs ?? []) as Array<{ id: string; label: string; lifted_at: string | null }>) reserveById.set(r.id, { label: r.label, liftedAt: r.lifted_at })
  }

  const reportNode = (reportId: string): CausalNode | null => {
    const r = reportById.get(reportId)
    if (!r) return null
    const d = frShort(r.date)
    return {
      kind: r.origin ? 'visite' : 'reunion',
      label: `${r.title?.trim() || (r.origin ? 'Visite' : 'Réunion')}${d ? ` · ${d}` : ''}`,
      detail: null, href: `/sites/${siteId}/reunion/${reportId}`,
    }
  }

  const threads: CausalThread[] = []
  for (const a of actions) {
    const dec = decByAction.get(a.id) ?? null
    const hasReserve = !!a.reserve_id && reserveById.has(a.reserve_id)
    const hasOrigin = !!a.report_id && reportById.has(a.report_id)
    // Pas d'histoire causale (ni décision, ni réserve, ni réunion d'origine) → on
    // n'invente pas un fil.
    if (!dec && !hasReserve && !hasOrigin) continue

    const action: CausalNode = { kind: 'action', label: a.title, detail: actionStatusLabel(a.status), href: `/sites/${siteId}?action=${a.id}&action_source=memoire` }

    const decision = dec
      ? { node: { kind: 'decision', label: dec.titre, detail: null, href: `/sites/${siteId}?decision=${dec.id}&decision_source=memoire` } as CausalNode, meeting: dec.reportId ? reportNode(dec.reportId) : null }
      : null
    const origin = !dec && hasOrigin ? reportNode(a.report_id as string) : null

    const reserve = hasReserve
      ? (() => {
          const rr = reserveById.get(a.reserve_id as string)!
          return {
            node: { kind: 'reserve', label: rr.label, detail: null, href: `/sites/${siteId}/reserves` } as CausalNode,
            lift: rr.liftedAt ? ({ kind: 'cloture', label: 'Réserve levée', detail: frShort(rr.liftedAt), href: `/sites/${siteId}/reserves` } as CausalNode) : null,
          }
        })()
      : null

    const cloture = !hasReserve && a.status === 'done'
      ? ({ kind: 'cloture', label: 'Action clôturée', detail: frShort(a.done_at), href: `/sites/${siteId}?action=${a.id}&action_source=memoire` } as CausalNode)
      : null

    threads.push(assembleThread({ actionId: a.id, action, decision, origin, reserve, cloture, title: a.title, subtitle: null }))
  }
  return threads
}
