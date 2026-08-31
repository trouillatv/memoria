import 'server-only'

// ── OBJETS ISSUS D'UNE VISITE (P0 · point 6) ─────────────────────────────────
// « Qu'est-ce que cette visite a réellement PRODUIT dans le chantier ? » — les
// objets métier MATÉRIALISÉS, jamais des compteurs, jamais une proposition « À
// confirmer ». Provenance STRUCTURELLE uniquement (FK vers le report) : aucun
// matching lexical, aucune reconstruction depuis le titre/contenu.
//   • actions   : site_actions.report_id  ∪  source_capture_id→visit_capture→report
//   • réserves  : site_reserve.report_id
//   • échéances : site_deadlines.report_id
//   • connaissances retenues : site_knowledge_entries.source_report_id (status='active')
// FK nulle ⇒ objet absent (rien n'est inféré). Tous statuts (une action clôturée
// reste historiquement issue de cette visite). Navigation : routes /m réelles ;
// quand la destination est un ESPACE (liste) et non la fiche de l'objet, le CTA
// le dit honnêtement (« Voir les réserves ») — jamais « Ouvrir ».

import { createAdminClient } from '@/lib/supabase/admin'

export interface VisitObjectItem {
  id: string
  label: string
  /** Badge d'état (« Ouverte », « Réalisée »…) ou null si non pertinent. */
  statusLabel: string | null
  /** Route /m réelle de destination. */
  href: string
  /** true = fiche précise de l'objet ; false = espace/liste métier (CTA honnête). */
  precise: boolean
  /** Libellé du lien : « Voir la fiche » (précis) vs « Voir les réserves »… (espace). */
  ctaLabel: string
}

export interface VisitObjects {
  actions: VisitObjectItem[]
  reserves: VisitObjectItem[]
  deadlines: VisitObjectItem[]
  knowledge: VisitObjectItem[]
  isEmpty: boolean
}

const ACTION_STATUS: Record<string, string> = { open: 'Ouverte', planned: 'Planifiée', done: 'Terminée', cancelled: 'Annulée' }
const RESERVE_STATUS: Record<string, string> = { open: 'Ouverte', lifted: 'Levée' }
const DEADLINE_STATUS: Record<string, string> = { to_plan: 'À planifier', planned: 'Planifiée', done: 'Réalisée', cancelled: 'Annulée', superseded: 'Remplacée' }
const KNOWLEDGE_KIND: Record<string, string> = { current_information: 'Information actuelle', durable_knowledge: 'Connaissance durable', observed_pattern: 'Habitude observée' }

export async function buildVisitObjects(reportId: string, siteId: string): Promise<VisitObjects> {
  const db = createAdminClient()

  // ── Actions : DEUX relations démontrées, unies et dédupliquées par id. Aucun
  //    filtre de statut (« issu de cette visite » ≠ « encore ouvert »). ──
  const { data: caps } = await db.from('visit_capture').select('id').eq('site_id', siteId).eq('report_id', reportId)
  const captureIds = ((caps ?? []) as Array<{ id: string }>).map((c) => c.id)

  const actionsById = new Map<string, { id: string; title: string; status: string; created_at: string }>()
  const { data: a1 } = await db.from('site_actions').select('id, title, status, created_at').eq('site_id', siteId).eq('report_id', reportId)
  for (const a of (a1 ?? []) as Array<{ id: string; title: string; status: string; created_at: string }>) actionsById.set(a.id, a)
  if (captureIds.length > 0) {
    const { data: a2 } = await db.from('site_actions').select('id, title, status, created_at').eq('site_id', siteId).in('source_capture_id', captureIds)
    for (const a of (a2 ?? []) as Array<{ id: string; title: string; status: string; created_at: string }>) actionsById.set(a.id, a)
  }
  const actions: VisitObjectItem[] = [...actionsById.values()]
    .sort((x, y) => x.created_at.localeCompare(y.created_at))
    .map((a) => ({
      id: a.id, label: a.title, statusLabel: ACTION_STATUS[a.status] ?? null,
      href: `/m/site/${siteId}/action/${a.id}`, precise: true, ctaLabel: 'Voir la fiche',
    }))

  // ── Réserves ──
  const { data: res } = await db.from('site_reserve').select('id, label, status').eq('site_id', siteId).eq('report_id', reportId).order('created_at', { ascending: true })
  const reserves: VisitObjectItem[] = ((res ?? []) as Array<{ id: string; label: string; status: string }>).map((r) => ({
    id: r.id, label: r.label, statusLabel: RESERVE_STATUS[r.status] ?? null,
    href: `/m/site/${siteId}/reserves`, precise: false, ctaLabel: 'Voir les réserves',
  }))

  // ── Échéances ──
  const { data: dl } = await db.from('site_deadlines').select('id, title, status').eq('site_id', siteId).eq('report_id', reportId).order('created_at', { ascending: true })
  const deadlines: VisitObjectItem[] = ((dl ?? []) as Array<{ id: string; title: string; status: string }>).map((d) => ({
    id: d.id, label: d.title, statusLabel: DEADLINE_STATUS[d.status] ?? null,
    href: `/m/planning`, precise: false, ctaLabel: 'Voir le planning',
  }))

  // ── Connaissances RETENUES (jamais une proposition : status='active', objet réel). ──
  const { data: kn } = await db.from('site_knowledge_entries')
    .select('id, title, kind').eq('site_id', siteId).eq('source_report_id', reportId)
    .eq('status', 'active').is('deleted_at', null).order('confirmed_at', { ascending: true })
  const knowledge: VisitObjectItem[] = ((kn ?? []) as Array<{ id: string; title: string; kind: string }>).map((k) => ({
    id: k.id, label: k.title, statusLabel: KNOWLEDGE_KIND[k.kind] ?? null,
    href: `/m/site/${siteId}/patrimoine`, precise: false, ctaLabel: 'Voir le patrimoine',
  }))

  const isEmpty = actions.length === 0 && reserves.length === 0 && deadlines.length === 0 && knowledge.length === 0
  return { actions, reserves, deadlines, knowledge, isEmpty }
}
