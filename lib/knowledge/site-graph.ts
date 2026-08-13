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
import { requireOrganizationMembership } from '@/lib/auth/memberships'
import { getVisitCapturePreviewUrls, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { listSiteIntervenants } from '@/lib/db/site-intervenants'

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
  /** VISITE : ce qu'elle a produit (comptes sur les objets chargés dans CE graphe). */
  produced?: { actions: number; echeances: number; decisions: number; memos: number; photos: number }
  /** VISITE : sujets canoniques qui ont évolué pendant cette visite (occurrences tracées). */
  evolved?: string[]
  /** ACTEUR : sujets canoniques atteints via ses actions assignées (STI → canonical). */
  subjects?: string[]
}

export interface GraphEdge {
  a: string
  b: string
  type: GraphNodeType
  /** Pourquoi ce lien existe — affiché au survol, jamais deviné. */
  why: string
  date?: string | null
  /** Arbitrage humain tracé en base : 'confirmed' (validé) ou 'proposed' (en
   *  attente). Absent = lien factuel/structurel (visite réalisée, photo prise…)
   *  qui ne relève d'aucun arbitrage — on n'invente pas de confiance. */
  status?: 'confirmed' | 'proposed'
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

/** Le graphe d'un chantier. `null` si l'appelant n'est pas MEMBRE de
 *  l'organisation DU chantier (fail-closed, résource-scopé). */
export async function getSiteGraph(siteId: string): Promise<SiteGraph | null> {
  const db = createAdminClient()

  // M3-D — l'accès vient de l'org DE LA RESSOURCE (le chantier), jamais de
  // `getOrgId()` (qui lèverait pour un compte multi-org). Toutes les lectures
  // ci-dessous sont déjà `.eq('site_id', siteId)` : le siteId fait le scope.
  const { data: site } = await db
    .from('sites').select('id, name, organization_id').eq('id', siteId).maybeSingle()
  if (!site) return null
  const siteOrgId = (site as { organization_id: string | null }).organization_id
  if (!siteOrgId || !(await requireOrganizationMembership(siteOrgId)).ok) return null
  const siteName = (site as { name: string }).name

  // Le casting confirmé part en parallèle des lectures Supabase ci-dessous.
  const intervenantsP = listSiteIntervenants(siteId).catch(() => [])
  const [reports, captures, actions, deadlines, decisions, watchpoints, proposals] = await Promise.all([
    db.from('site_reports').select('id, started_at').eq('site_id', siteId)
      .order('started_at', { ascending: true }).limit(CAP.reports),
    db.from('visit_capture').select('id, kind, body, report_id, attachment_id').eq('site_id', siteId)
      .is('hidden_at', null),
    db.from('site_actions')
      .select('id, title, status, report_id, created_at, assigned_company_id, assigned_contact_id, subject_thread_id')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false }).limit(CAP.actions),
    db.from('site_deadlines').select('id, title, status, due_date, constraint_text, report_id, created_at')
      .eq('site_id', siteId).order('created_at', { ascending: false }).limit(CAP.deadlines),
    db.from('site_decisions').select('id, titre, report_id, date_decision, created_at').eq('site_id', siteId)
      .order('created_at', { ascending: false }).limit(CAP.decisions),
    db.from('site_watchpoints').select('id, title, report_id, confirmed_at').eq('site_id', siteId)
      .eq('status', 'active').is('deleted_at', null).limit(CAP.watchpoints),
    db.from('site_knowledge_proposals')
      .select('id, kind, status, title, report_id, source_capture_ids, promoted_object_id')
      // 'fulfilled' a produit un objet au même titre que 'confirmed' (mig 231) :
      // l'omettre effacerait du graphe des liens qui existent bel et bien.
      .eq('site_id', siteId).in('status', ['proposed', 'confirmed', 'fulfilled']).limit(80),
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
    if ((p.status === 'confirmed' || p.status === 'fulfilled') && p.promoted_object_id && PREFIX[p.kind]) {
      const objId = PREFIX[p.kind] + p.promoted_object_id
      // LE LIEN EXISTE DANS LES DEUX CAS, MAIS PAS POUR LA MÊME RAISON — et le
      // graphe est un moteur d'EXPLICATION : dire « confirmé par un humain »
      // d'un objet né de la concrétisation inventerait un arbitrage.
      const why = p.status === 'confirmed'
        ? 'Extrait de cette transcription, confirmé par un humain'
        : 'Extrait de cette transcription, créé depuis le compte-rendu corrigé'
      for (const capId of p.source_capture_ids ?? []) {
        link({ a: `m_${capId}`, b: objId, type: (p.kind === 'deadline' ? 'ech' : p.kind === 'decision' ? 'dec' : p.kind) as GraphNodeType, why, status: 'confirmed' })
      }
    }
  }

  // Les intervenants CONFIRMÉS (casting actif, migs 137/138). La confirmation
  // ENRICHIT la carte : avant, seules les propositions 'proposed' devenaient des
  // nœuds — confirmer une personne la faisait DISPARAÎTRE d'Explorer. Même
  // doctrine que l'Aperçu : un fait confirmé ne s'évapore jamais.
  const intervenants = await intervenantsP
  for (const it of intervenants) {
    const aid = `int_${it.id}`
    add({
      id: aid, type: 'acteur',
      label: it.contactName ?? (it.companyShort || it.companyName),
      sub: it.contactName ? `${it.companyShort || it.companyName} · ${it.role}` : `Intervenant · ${it.role}`,
      t: it.effectiveFrom,
    })
    link({ a: 'site', b: aid, type: 'acteur', why: `Intervenant confirmé du chantier — rôle ${it.role}`, status: 'confirmed' })
    if (it.sourceReportId) {
      link({ a: `v_${it.sourceReportId}`, b: aid, type: 'acteur', why: 'Ajouté au casting depuis cette visite', status: 'confirmed' })
    }
  }

  // ── Assignations : l'action porte son responsable EN BASE (assigned_company_id /
  // assigned_contact_id, casting mig 137+). Le lien acteur→action n'est pas déduit :
  // c'est l'assignation elle-même. C'est ce qui fait dire au nœud « Électriciens »
  // ce qu'il porte réellement.
  type ActionRow = {
    id: string; title: string; status: string; report_id: string | null; created_at: string
    assigned_company_id: string | null; assigned_contact_id: string | null; subject_thread_id: string | null
  }
  const actionRows = (actions.data ?? []) as ActionRow[]
  const intByCompany = new Map<string, string>()
  const intByContact = new Map<string, string>()
  for (const it of intervenants) {
    if (!intByCompany.has(it.companyId)) intByCompany.set(it.companyId, `int_${it.id}`)
    if (it.mainContactId && !intByContact.has(it.mainContactId)) intByContact.set(it.mainContactId, `int_${it.id}`)
  }
  const actorActionThreads = new Map<string, Set<string>>()  // acteur node id → thread ids de ses actions
  for (const a of actionRows) {
    const actorNode =
      (a.assigned_contact_id && intByContact.get(a.assigned_contact_id)) ||
      (a.assigned_company_id && intByCompany.get(a.assigned_company_id)) || null
    if (!actorNode) continue
    link({ a: actorNode, b: `a_${a.id}`, type: 'action', why: 'Action assignée à cet intervenant', date: fr(a.created_at), status: 'confirmed' })
    if (a.subject_thread_id) {
      ;(actorActionThreads.get(actorNode) ?? actorActionThreads.set(actorNode, new Set()).get(actorNode)!).add(a.subject_thread_id)
    }
  }

  // Sujets concernés par acteur : les threads de ses actions, résolus vers le
  // sujet canonique (STI). Lecture pure — aucun lien inventé.
  const allActorThreads = [...new Set([...actorActionThreads.values()].flatMap((s) => [...s]))]
  if (allActorThreads.length > 0) {
    const { data: stiRows } = await db
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', allActorThreads)
    const threadToCS = new Map(
      ((stiRows ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
        .map((r) => [r.subject_thread_id, r.canonical_subject_id]),
    )
    const csIds = [...new Set([...threadToCS.values()])]
    if (csIds.length > 0) {
      const { data: csRows } = await db
        .from('canonical_subject').select('id, label').in('id', csIds)
      const csLabelById = new Map(
        ((csRows ?? []) as Array<{ id: string; label: string }>).map((r) => [r.id, r.label]),
      )
      for (const [actorNode, threads] of actorActionThreads) {
        const labels = [...new Set(
          [...threads].map((t) => threadToCS.get(t)).filter((x): x is string => !!x)
            .map((id) => csLabelById.get(id)).filter((x): x is string => !!x),
        )]
        if (labels.length > 0) {
          const n = nodes.find((x) => x.id === actorNode)
          if (n) n.subjects = labels
        }
      }
    }
  }

  // Les mentions confirmées rejoignent LEUR intervenant : promoted_object_id
  // vise le lien du casting (nouvelles promotions) ou l'entreprise (lignes
  // promues avant que l'id du lien soit tracé) — on accepte les deux.
  const intNodeByObjectId = new Map<string, string>()
  for (const it of intervenants) {
    intNodeByObjectId.set(it.id, `int_${it.id}`)
    if (!intNodeByObjectId.has(it.companyId)) intNodeByObjectId.set(it.companyId, `int_${it.id}`)
  }
  for (const p of props.filter((x) => x.kind === 'stakeholder' && x.status === 'confirmed' && x.promoted_object_id)) {
    const target = intNodeByObjectId.get(p.promoted_object_id!)
    if (!target) continue
    for (const capId of p.source_capture_ids ?? []) {
      link({ a: `m_${capId}`, b: target, type: 'acteur', why: 'Mentionné dans cette transcription — confirmé par un humain', status: 'confirmed' })
    }
    if ((p.source_capture_ids ?? []).length === 0 && p.report_id) {
      link({ a: `v_${p.report_id}`, b: target, type: 'acteur', why: 'Cité pendant cette visite — confirmé', status: 'confirmed' })
    }
  }

  // Les acteurs cités (propositions stakeholder encore ouvertes).
  for (const p of props.filter((x) => x.kind === 'stakeholder' && x.status === 'proposed')) {
    const aid = `act_${p.id}`
    add({ id: aid, type: 'acteur', label: p.title, sub: 'Intervenant · à confirmer', t: tOf(p.report_id) })
    link({ a: 'site', b: aid, type: 'acteur', why: 'Cité sur ce chantier — jamais confirmé', status: 'proposed' })
    for (const capId of p.source_capture_ids ?? []) {
      link({ a: `m_${capId}`, b: aid, type: 'acteur', why: 'Mentionné dans cette transcription', status: 'proposed' })
    }
    if ((p.source_capture_ids ?? []).length === 0 && p.report_id) {
      link({ a: `v_${p.report_id}`, b: aid, type: 'acteur', why: 'Détecté pendant cette visite', status: 'proposed' })
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

  // ── Synthèse par visite : ce qu'elle a produit (comptes sur les objets DE CE
  // graphe — cohérent avec ce que l'écran montre) + les sujets canoniques qui
  // ont évolué (occurrences tracées sur ce report, mig 268+).
  const producedByReport = new Map<string, NonNullable<GraphNode['produced']>>()
  const bump = (rid: string | null, key: keyof NonNullable<GraphNode['produced']>) => {
    if (!rid || !reportDate.has(rid)) return
    const p = producedByReport.get(rid) ?? { actions: 0, echeances: 0, decisions: 0, memos: 0, photos: 0 }
    p[key] += 1
    producedByReport.set(rid, p)
  }
  for (const a of actionRows) bump(a.report_id, 'actions')
  for (const d of (deadlines.data ?? []) as Array<{ report_id: string | null }>) bump(d.report_id, 'echeances')
  for (const d of (decisions.data ?? []) as Array<{ report_id: string | null }>) bump(d.report_id, 'decisions')
  for (const c of caps) {
    if (c.kind === 'photo') bump(c.report_id, 'photos')
    else if (c.body && ['vocal', 'note'].includes(c.kind)) bump(c.report_id, 'memos')
  }

  const evolvedByReport = new Map<string, string[]>()
  {
    const { data: siteCS } = await db
      .from('canonical_subject').select('id, label').eq('site_id', siteId).eq('status', 'active')
    const csLabel = new Map(
      ((siteCS ?? []) as Array<{ id: string; label: string }>).map((r) => [r.id, r.label]),
    )
    if (csLabel.size > 0 && reportRows.length > 0) {
      const { data: occRows } = await db
        .from('canonical_subject_occurrence')
        .select('canonical_subject_id, source_ref_id')
        .in('canonical_subject_id', [...csLabel.keys()])
        .in('source_ref_id', reportRows.map((r) => r.id))
      for (const o of (occRows ?? []) as Array<{ canonical_subject_id: string; source_ref_id: string }>) {
        const label = csLabel.get(o.canonical_subject_id)
        if (!label) continue
        const list = evolvedByReport.get(o.source_ref_id) ?? []
        if (!list.includes(label)) { list.push(label); evolvedByReport.set(o.source_ref_id, list) }
      }
    }
  }

  for (const n of nodes) {
    if (n.type !== 'visite') continue
    const rid = n.id.slice(2)
    const p = producedByReport.get(rid)
    if (p && (p.actions || p.echeances || p.decisions || p.memos || p.photos)) n.produced = p
    const ev = evolvedByReport.get(rid)
    if (ev && ev.length > 0) n.evolved = ev
  }

  return { siteId, siteName, nodes, edges }
}
