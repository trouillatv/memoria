import 'server-only'

// ── LE GRAPHE DU CHANTIER — read model de l'onglet Explorer ──────────────────
// « Une seule mémoire, des dizaines de portes. » L'onglet Explorer lit la même
// base que la Mémoire et l'Aperçu ; il ne stocke RIEN : les arêtes existent
// déjà (report_id, source_capture_ids, promoted_object_id — mig 212). Ce read
// model les rend navigables.
//
// Chaque arête SAIT pourquoi elle existe (règle « rien d'affiché sans preuve ») :
// le survol l'explique, la fiche la raconte. Aucune inférence, aucun score —
// uniquement des liens de provenance et de citation, datés.
//
// Chaque nœud porte sa DATE D'APPARITION (`t`) : c'est elle qui permet au
// replay (« ▶ Rejouer cette histoire ») de faire vivre le chantier — un fait
// observé, jamais une reconstruction.
//
// Bornes volontaires (un graphe illisible n'explique rien) : les listes sont
// plafonnées, et le plafond est DIT dans le nœud de groupe.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgId } from '@/lib/db/users'
import { getVisitCapturePreviewUrls, type VisitCaptureRow } from '@/lib/db/visit-captures'

export type GraphNodeType =
  | 'site' | 'visite' | 'photo' | 'memo'
  | 'action' | 'ech' | 'dec' | 'vigilance' | 'acteur' | 'know'

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  sub?: string | null
  count?: number
  /** Le mémo, mot pour mot (tronqué) — la preuve. */
  excerpt?: string | null
  /** Date d'apparition dans la mémoire (ISO) — pour le replay temporel. */
  t?: string | null
  /** Les vraies miniatures (URLs signées) — l'objet réel, pas un nœud abstrait. */
  photos?: Array<{ id: string; url: string }>
}

export interface GraphEdge {
  a: string
  b: string
  type: GraphNodeType
  /** Pourquoi ce lien existe — affiché au survol, jamais deviné. */
  why: string
  date?: string | null
}

export interface SiteGraph {
  siteId: string
  siteName: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const CAP = { actions: 12, deadlines: 12, decisions: 8, watchpoints: 8, reports: 6, thumbs: 8 }

const dayFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long',
})
const fr = (iso: string | null | undefined) => (iso ? dayFmt.format(new Date(iso)) : null)

/** Le graphe d'un chantier. `null` si le chantier n'appartient pas à
 *  l'organisation de l'appelant (fail-closed). */
export async function getSiteGraph(siteId: string): Promise<SiteGraph | null> {
  const orgId = await getOrgId()
  if (!orgId) return null
  const db = createAdminClient()

  const { data: site } = await db
    .from('sites').select('id, name, organization_id').eq('id', siteId).maybeSingle()
  if (!site || (site as { organization_id: string | null }).organization_id !== orgId) return null
  const siteName = (site as { name: string }).name

  const [reports, captures, actions, deadlines, decisions, watchpoints, proposals] = await Promise.all([
    db.from('site_reports').select('id, started_at').eq('site_id', siteId)
      .order('started_at', { ascending: true }).limit(CAP.reports),
    db.from('visit_capture').select('id, kind, body, report_id, attachment_id').eq('site_id', siteId)
      .is('hidden_at', null),
    db.from('site_actions').select('id, title, status, report_id, created_at').eq('site_id', siteId)
      .order('created_at', { ascending: false }).limit(CAP.actions),
    db.from('site_deadlines').select('id, title, status, due_date, constraint_text, report_id, created_at')
      .eq('site_id', siteId).order('created_at', { ascending: false }).limit(CAP.deadlines),
    db.from('site_decisions').select('id, titre, report_id, date_decision, created_at').eq('site_id', siteId)
      .order('created_at', { ascending: false }).limit(CAP.decisions),
    db.from('site_watchpoints').select('id, title, report_id, confirmed_at').eq('site_id', siteId)
      .eq('status', 'active').is('deleted_at', null).limit(CAP.watchpoints),
    db.from('site_knowledge_proposals')
      .select('id, kind, status, title, report_id, source_capture_ids, promoted_object_id')
      .eq('site_id', siteId).in('status', ['proposed', 'confirmed']).limit(80),
  ])

  const nodes: GraphNode[] = [{ id: 'site', type: 'site', label: siteName }]
  const edges: GraphEdge[] = []
  const has = new Set<string>(['site'])
  const add = (n: GraphNode) => { if (!has.has(n.id)) { nodes.push(n); has.add(n.id) } }
  const link = (e: GraphEdge) => {
    if (has.has(e.a) && has.has(e.b) && !edges.some((x) => x.a === e.a && x.b === e.b)) edges.push(e)
  }

  // La date de visite par report — elle date aussi tout ce qui en descend.
  const reportRows = (reports.data ?? []) as Array<{ id: string; started_at: string | null }>
  const reportDate = new Map(reportRows.map((r) => [r.id, r.started_at]))
  const tOf = (reportId: string | null | undefined) => (reportId ? reportDate.get(reportId) ?? null : null)

  // Visites + leurs preuves (photos groupées AVEC vraies miniatures, mémos textuels).
  type Cap = { id: string; kind: string; body: string | null; report_id: string | null; attachment_id: string | null }
  const caps = (captures.data ?? []) as Cap[]
  const photoCaps = caps.filter((c) => c.kind === 'photo' && c.attachment_id)
  const thumbUrls = await getVisitCapturePreviewUrls(
    photoCaps.slice(0, CAP.thumbs) as unknown as VisitCaptureRow[],
  ).catch(() => ({} as Record<string, { url: string }>))

  for (const r of reportRows) {
    const vid = `v_${r.id}`
    const date = fr(r.started_at)
    add({ id: vid, type: 'visite', label: date ? `Visite du ${date}` : 'Visite', t: r.started_at })
    link({ a: 'site', b: vid, type: 'visite', why: 'Visite réalisée sur ce chantier', date })

    const photos = caps.filter((c) => c.report_id === r.id && c.kind === 'photo')
    if (photos.length > 0) {
      const pid = `ph_${r.id}`
      add({
        id: pid, type: 'photo', label: 'Photos', count: photos.length,
        sub: `${photos.length} photo${photos.length > 1 ? 's' : ''} de visite`, t: r.started_at,
        photos: photos
          .map((c) => ({ id: c.id, url: thumbUrls[c.id]?.url ?? '' }))
          .filter((x) => x.url)
          .slice(0, CAP.thumbs),
      })
      link({ a: vid, b: pid, type: 'photo', why: `${photos.length} photo${photos.length > 1 ? 's' : ''} prise${photos.length > 1 ? 's' : ''} pendant la visite`, date })
    }
    for (const c of caps.filter((x) => x.report_id === r.id && x.body && ['vocal', 'note'].includes(x.kind))) {
      add({
        id: `m_${c.id}`, type: 'memo',
        label: c.kind === 'vocal' ? 'Mémo vocal' : 'Note de visite',
        excerpt: c.body!.length > 220 ? c.body!.slice(0, 217) + '…' : c.body,
        t: r.started_at,
      })
      link({ a: vid, b: `m_${c.id}`, type: 'memo', why: 'Dicté pendant la visite', date })
    }
  }

  // Les objets confirmés — datés par leur confirmation (le replay les fait
  // apparaître au moment où ils sont ENTRÉS dans la mémoire).
  for (const a of (actions.data ?? []) as Array<{ id: string; title: string; status: string; report_id: string | null; created_at: string }>) {
    add({ id: `a_${a.id}`, type: 'action', label: a.title, sub: a.status === 'open' ? 'Action ouverte' : 'Action', t: a.created_at })
  }
  for (const d of (deadlines.data ?? []) as Array<{ id: string; title: string; due_date: string | null; constraint_text: string | null; report_id: string | null; created_at: string }>) {
    add({
      id: `e_${d.id}`, type: 'ech', label: d.title,
      sub: d.due_date ? `Échéance · ${fr(d.due_date)}` : d.constraint_text ? `À planifier · « ${d.constraint_text} »` : 'À planifier',
      t: d.created_at,
    })
  }
  for (const d of (decisions.data ?? []) as Array<{ id: string; titre: string; date_decision: string | null; created_at: string }>) {
    add({ id: `d_${d.id}`, type: 'dec', label: d.titre, sub: d.date_decision ? `Décision actée · ${fr(d.date_decision)}` : 'Décision actée', t: d.date_decision ?? d.created_at })
  }
  for (const w of (watchpoints.data ?? []) as Array<{ id: string; title: string; confirmed_at: string | null }>) {
    add({ id: `w_${w.id}`, type: 'vigilance', label: w.title, sub: 'Point de vigilance', t: w.confirmed_at })
  }

  // Les liens de provenance : la proposition (mig 212) relie le mémo d'origine
  // à l'objet qu'elle a fait naître. C'est la même chaîne que « Pourquoi ? ».
  type Prop = { id: string; kind: string; status: string; title: string; report_id: string | null; source_capture_ids: string[] | null; promoted_object_id: string | null }
  const props = (proposals.data ?? []) as Prop[]
  const PREFIX: Record<string, string> = { action: 'a_', deadline: 'e_', decision: 'd_', vigilance: 'w_' }
  for (const p of props) {
    if (p.status === 'confirmed' && p.promoted_object_id && PREFIX[p.kind]) {
      const objId = PREFIX[p.kind] + p.promoted_object_id
      for (const capId of p.source_capture_ids ?? []) {
        link({ a: `m_${capId}`, b: objId, type: (p.kind === 'deadline' ? 'ech' : p.kind === 'decision' ? 'dec' : p.kind) as GraphNodeType, why: 'Extrait de cette transcription, confirmé par un humain' })
      }
    }
  }

  // Les acteurs cités (propositions stakeholder encore ouvertes).
  for (const p of props.filter((x) => x.kind === 'stakeholder' && x.status === 'proposed')) {
    const aid = `act_${p.id}`
    add({ id: aid, type: 'acteur', label: p.title, sub: 'Intervenant · à confirmer', t: tOf(p.report_id) })
    link({ a: 'site', b: aid, type: 'acteur', why: 'Cité sur ce chantier — jamais confirmé' })
    for (const capId of p.source_capture_ids ?? []) {
      link({ a: `m_${capId}`, b: aid, type: 'acteur', why: 'Mentionné dans cette transcription' })
    }
    if ((p.source_capture_ids ?? []).length === 0 && p.report_id) {
      link({ a: `v_${p.report_id}`, b: aid, type: 'acteur', why: 'Détecté pendant cette visite' })
    }
  }

  // « À savoir » en attente : un groupe, pas un nœud par phrase.
  const knows = props.filter((x) => x.kind === 'knowledge' && x.status === 'proposed')
  if (knows.length > 0) {
    add({ id: 'know', type: 'know', label: 'À savoir', count: knows.length, sub: `${knows.length} information${knows.length > 1 ? 's' : ''} à confirmer`, t: tOf(knows[0].report_id) })
    const rid = knows[0].report_id
    if (rid) link({ a: `v_${rid}`, b: 'know', type: 'know', why: 'Extraites des mémos de cette visite' })
    else link({ a: 'site', b: 'know', type: 'know', why: 'Informations en attente de confirmation' })
  }

  // Un objet sans lien mémo mais avec une visite d'origine se raccroche à elle
  // (sinon il flotterait — un nœud orphelin n'explique rien).
  const linked = new Set(edges.flatMap((e) => [e.a, e.b]))
  const attach = (id: string, reportId: string | null, type: GraphNodeType) => {
    if (linked.has(id)) return
    if (reportId && has.has(`v_${reportId}`)) {
      link({ a: `v_${reportId}`, b: id, type, why: 'Issu de la synthèse de cette visite' })
    } else {
      link({ a: 'site', b: id, type, why: 'Élément du chantier' })
    }
  }
  for (const a of (actions.data ?? []) as Array<{ id: string; report_id: string | null }>) attach(`a_${a.id}`, a.report_id, 'action')
  for (const d of (deadlines.data ?? []) as Array<{ id: string; report_id: string | null }>) attach(`e_${d.id}`, d.report_id, 'ech')
  for (const d of (decisions.data ?? []) as Array<{ id: string; report_id: string | null }>) attach(`d_${d.id}`, d.report_id, 'dec')
  for (const w of (watchpoints.data ?? []) as Array<{ id: string; report_id: string | null }>) attach(`w_${w.id}`, w.report_id, 'vigilance')

  return { siteId, siteName, nodes, edges }
}
