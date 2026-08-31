// N1 — ASSEMBLAGE DU RÉCIT DE VISITE. Lecture seule, aucun écran.
//
// Les quatre couches viennent de sources qui existent déjà — c'est tout le
// propos de l'audit : la provenance était là, elle n'était pas lue.
//
//   captured   `visit_capture`, écartées comprises et marquées comme telles
//   understood `site_knowledge_proposals` (mig 212) — ce que MemorIA a proposé.
//              ATTENTION : ce n'est PAS `site_report_proposals` (mig 099), qui
//              porte un autre cycle. Défaut trouvé en essayant ce module sur la
//              visite réelle : la mauvaise table rendait `understood` vide alors
//              que l'écran, lui, affichait bien des propositions.
//   validated  le statut de ces propositions + le cycle de vie du document
//   produced   le registre de concrétisation, puis le `report_id`
//
// Ce module n'invente rien et ne calcule aucune moyenne : il rapporte.

import { createAdminClient } from '@/lib/supabase/admin'
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { traceRegistryLine } from '@/lib/visits/promotion'
import type { SectionPromotion } from '@/types/db'
import {
  classifyProduced,
  describeLimits,
  explainCapture,
  explainProposal,
  explainProduced,
  type Reason,
  type NarrativeLimits,
  type ProducedObject,
  type RegistryEntry,
  type ReportLinkedObject,
} from '@/lib/visits/narrative'

export interface NarrativeCapture {
  id: string
  kind: string
  body: string | null
  capturedAt: string
  lat: number | null
  lng: number | null
  /** Retenue ou écartée — une capture écartée reste une preuve consultable. */
  kept: boolean
  /** Ce que le conducteur en a dit au tri : action, réserve à lever, à surveiller. */
  intent: string | null
  /** Pourquoi cette ligne est là — dérivé d'un fait, jamais deviné. */
  why: Reason
  /** La pièce jointe, quand il y en a une : c'est elle qui permet d'écouter le
   *  vocal ou de revoir la photo. Simple plomberie d'affichage. */
  attachmentId: string | null
  /** Quand la pièce est ENTRÉE au dossier — distinct de l'instant où le fait
   *  s'est produit. Une visite est figée ; son dossier ne l'est pas. */
  addedAt: string
  /** Versée au dossier APRÈS la clôture de la visite. On ne réécrit pas le
   *  passé : on le complète, et on le dit. */
  addedAfterVisit: boolean
  /** Entrée depuis la dernière analyse : MemorIA ne l'a pas encore lue. */
  sinceLastAnalysis: boolean
  /** D'où vient `capturedAt` (mig 230). NULL quand on ne sait pas — et on
   *  ne le devine pas : l'écran dira alors seulement quand elle est entrée. */
  dateSource: 'file' | 'visit' | 'today' | 'chosen' | null
}

export interface NarrativeProposal {
  id: string
  type: string
  label: string
  rationale: string | null
  confidence: number | null
  /** mig 212 : proposed = en attente · confirmed · dismissed · superseded. */
  status: string
  /** L'objet né de cette proposition, s'il existe. */
  createdEntityId: string | null
  /** Pour les superseded : permet la résolution "Même sujet →" sans modifier la DB. */
  canonicalSubjectId: string | null
  /** Combien de captures ont nourri cette proposition (`source_capture_ids`).
   *  « Sources : 2 éléments » n'est pas décoratif : c'est ce qui distingue une
   *  lecture appuyée d'une lecture isolée. */
  sourceCount: number
  why: Reason
}

export interface NarrativeDocument {
  id: string
  status: string
  validatedAt: string | null
  validatedBy: string | null
  reopenedAt: string | null
  /** Sections corrigées par un humain (content ≠ ai_content). */
  correctedSections: string[]
}

export interface VisitNarrative {
  reportId: string
  siteId: string | null
  /** Ce qui a été capté. */
  captured: NarrativeCapture[]
  /** Ce que MemorIA a proposé — jamais une vérité humaine. */
  understood: NarrativeProposal[]
  /** LES ARBITRAGES HUMAINS — et eux seuls (Vincent, 2026-07-21).
   *  `superseded` n'y figure pas : c'est une obsolescence ALGORITHMIQUE (une
   *  analyse plus récente ne redit plus le fait), jamais un rejet. L'afficher
   *  comme « ignoré par Guillaume » lui prêterait une décision qu'il n'a pas
   *  prise. */
  validated: {
    document: NarrativeDocument | null
    /** Propositions explicitement confirmées par un humain. */
    confirmedProposals: number
    /** Propositions explicitement écartées par un humain. */
    ignoredProposals: number
    /** Encore en attente d'un arbitrage. */
    pendingProposals: number
    /** Obsolètes par régénération — NI validées, NI rejetées. */
    supersededProposals: number
    /** Sections du compte-rendu corrigées à la main : une validation
     *  éditoriale, même avant toute concrétisation. */
    correctedSections: string[]
    /** Captures explicitement écartées par le conducteur. */
    discardedCaptures: number
  }
  /** Chaque objet porte SON motif : de quelle section il vient, ou de quelle
   *  proposition. Un écran n'a plus rien à deviner.
   *
   *  CE QUE LE SYSTÈME A EFFECTIVEMENT MATÉRIALISÉ. Lecture EXCLUSIVE du
   *  journal de concrétisation, quelle que soit la porte utilisée. Un objet
   *  simplement rattaché par `report_id` n'y entre pas : il est compté dans
   *  les limites, parce qu'on ne peut pas prouver qu'il est né de ce récit. */
  produced: Array<ProducedObject & {
    why: Reason
    /** LE 4ᵉ MAILLON, quand il existe : la preuve d'où vient la ligne du
     *  compte-rendu qui a fait naître cet objet. `null` pour une ligne née de
     *  l'analyse du corpus — et c'est la vérité, pas un trou à combler. */
    evidence: SectionPromotion | null
  }>
  /** CE QUI N'A PAS ÉTÉ RETENU — et pourquoi (N3.1). Beaucoup d'IA ne montrent
   *  que ce qu'elles ont gardé. Montrer les écarts rend le système crédible :
   *  MemorIA ne cherche pas à avoir eu raison. Les trois natures restent
   *  distinctes — un refus humain n'est pas une obsolescence de calcul. */
  ignored: {
    /** Propositions explicitement écartées par un humain. */
    byHuman: Array<{ id: string; label: string; type: string; why: Reason }>
    /** Propositions périmées par une analyse plus récente — aucune décision. */
    superseded: Array<{ id: string; label: string; type: string; canonicalSubjectId: string | null; why: Reason }>
    /** Captures que le conducteur a sorties du compte-rendu. */
    captures: Array<{ id: string; kind: string; body: string | null; why: Reason }>
  }
  /** LE DOSSIER S'EST-IL ENRICHI DEPUIS LA DERNIÈRE LECTURE ? (2026-07-22)
   *  Un constat, jamais un déclenchement : réanalyser coûte un appel au modèle,
   *  et c'est l'humain qui décide. Le récit signale, il n'agit pas. */
  enrichment: {
    /** Pièces entrées au dossier après la clôture de la visite. */
    afterVisit: number
    /** Pièces que la dernière analyse n'a pas pu lire. */
    sinceLastAnalysis: number
    lastAnalysisAt: string | null
  }
  /** Ce que le récit ne sait pas — dit, jamais masqué. */
  limits: NarrativeLimits
  /** Objets rattachés par report_id mais absents du journal de concrétisation.
   *  Pour origin='import' : les objets créés directement par le RPC. */
  historical: ReportLinkedObject[]
}

// ── CE QUE CETTE VISITE CHANGE — regroupement par sujet canonique ──────────

export interface VisitChangeGroup {
  canonicalSubjectId: string | null   // null = groupe 'sans sujet identifié'
  subjectLabel: string | null
  actions: Array<{ id: string; title: string; status: string | null; priority: string | null }>
  deadlines: Array<{ id: string; title: string; dueDate: string | null }>
  /** Connaissances RETENUES (site_knowledge_entries, status='active') — la mémoire
   *  durable du chantier, PAS un fait simplement capté (captured_knowledge, qui
   *  reste une donnée d'extraction, jamais un « objet produit »). */
  knowledge: Array<{ id: string; title: string; kind: string }>
  watchpoints: Array<{ id: string; title: string }>
  decisions: Array<{ id: string; title: string }>
  reserves: Array<{ id: string; label: string }>
  stakeholders: Array<{ id: string; role: string; label: string }>
  sourceCount: number
}

// Types internes pour groupVisitChanges — canonical_subject déjà résolu en amont
type RAction = { id: string; title: string; status: string | null; priority: string | null; canonicalSubjectId: string | null; subjectLabel: string | null }
type RDeadline = { id: string; title: string; dueDate: string | null; canonicalSubjectId: string | null; subjectLabel: string | null }
type RKnowledge = { id: string; title: string; kind: string; canonicalSubjectId: string | null; subjectLabel: string | null }
type RWatchpoint = { id: string; title: string; canonicalSubjectId: string | null; subjectLabel: string | null }
type RDecision = { id: string; title: string; canonicalSubjectId: string | null; subjectLabel: string | null }
type RReserve = { id: string; label: string; canonicalSubjectId: string | null; subjectLabel: string | null }
type RStakeholder = { id: string; role: string; label: string; canonicalSubjectId: string | null; subjectLabel: string | null }

interface VisitChangesInput {
  actions: RAction[]
  deadlines: RDeadline[]
  knowledge: RKnowledge[]
  watchpoints: RWatchpoint[]
  decisions: RDecision[]
  reserves: RReserve[]
  stakeholders: RStakeholder[]
}

/** Pur — testable sans base. */
export function groupVisitChanges(input: VisitChangesInput): VisitChangeGroup[] {
  const groups = new Map<string, VisitChangeGroup>()

  function getOrCreate(csId: string | null, label: string | null): VisitChangeGroup {
    const key = csId ?? '__unclassified__'
    if (!groups.has(key)) {
      groups.set(key, { canonicalSubjectId: csId, subjectLabel: label, actions: [], deadlines: [], knowledge: [], watchpoints: [], decisions: [], reserves: [], stakeholders: [], sourceCount: 0 })
    }
    return groups.get(key)!
  }

  for (const a of input.actions) {
    const g = getOrCreate(a.canonicalSubjectId, a.subjectLabel)
    g.actions.push({ id: a.id, title: a.title, status: a.status, priority: a.priority })
    g.sourceCount++
  }
  for (const d of input.deadlines) {
    const g = getOrCreate(d.canonicalSubjectId, d.subjectLabel)
    g.deadlines.push({ id: d.id, title: d.title, dueDate: d.dueDate })
    g.sourceCount++
  }
  for (const f of input.knowledge) {
    const g = getOrCreate(f.canonicalSubjectId, f.subjectLabel)
    g.knowledge.push({ id: f.id, title: f.title, kind: f.kind })
    g.sourceCount++
  }
  for (const w of input.watchpoints) {
    const g = getOrCreate(w.canonicalSubjectId, w.subjectLabel)
    g.watchpoints.push({ id: w.id, title: w.title })
    g.sourceCount++
  }
  for (const d of input.decisions) {
    const g = getOrCreate(d.canonicalSubjectId, d.subjectLabel)
    g.decisions.push({ id: d.id, title: d.title })
    g.sourceCount++
  }
  for (const r of input.reserves) {
    const g = getOrCreate(r.canonicalSubjectId, r.subjectLabel)
    g.reserves.push({ id: r.id, label: r.label })
    g.sourceCount++
  }
  for (const s of input.stakeholders) {
    const g = getOrCreate(s.canonicalSubjectId, s.subjectLabel)
    g.stakeholders.push({ id: s.id, role: s.role, label: s.label })
    g.sourceCount++
  }

  return [...groups.values()]
    .filter(g => g.sourceCount > 0)
    .sort((a, b) => {
      if (a.canonicalSubjectId === null && b.canonicalSubjectId !== null) return 1
      if (a.canonicalSubjectId !== null && b.canonicalSubjectId === null) return -1
      return (a.subjectLabel ?? '').localeCompare(b.subjectLabel ?? '', 'fr')
    })
}

/**
 * Ce que cette visite a changé, groupé par sujet canonique.
 *
 * Deux chemins de résolution :
 *   1. site_actions : subject_thread_id → subject_thread_identity → canonical_subject
 *   2. Autres objets : site_knowledge_proposals (promoted_object_id, !superseded) → canonical_subject_id
 *
 * Problème documenté (lot suivant) :
 *   Une réanalyse supersede les propositions sans réconcilier les objets déjà
 *   matérialisés. Un objet créé avant la réanalyse reste lié à la visite via
 *   report_id même si son ancienne proposition est désormais superseded.
 *   Ce filtre empêche les doublons dans le regroupement, mais ne supprime pas
 *   l'objet du groupe "sans sujet identifié". Résolution complète prévue dans
 *   "Synchronisation des impacts d'une visite éditable".
 */
export async function buildVisitChanges(reportId: string): Promise<VisitChangeGroup[]> {
  const db = createAdminClient()

  // ── ACTIONS : DEUX relations démontrées vers la visite, unies + dédupliquées.
  //    (1) report_id direct ; (2) source_capture_id → visit_capture de ce report.
  //    Une action née d'une capture de la visite EST issue de la visite, même si
  //    son report_id direct est nul. Tous statuts (une action clôturée reste
  //    historiquement produite par cette visite). ──
  const { data: capRows } = await db.from('visit_capture').select('id').eq('report_id', reportId)
  const captureIds = ((capRows ?? []) as Array<{ id: string }>).map((c) => c.id)

  const [actionsDirectRes, proposalsRes, actionsCaptureRes] = await Promise.all([
    db.from('site_actions')
      .select('id, title, status, priority, subject_thread_id')
      .eq('report_id', reportId)
      .is('deleted_at', null),
    // Propositions promues, non-superseded, hors kind='action' (chemin direct STI)
    db.from('site_knowledge_proposals')
      .select('id, kind, promoted_object_id, promoted_object_type, canonical_subject_id')
      .eq('report_id', reportId)
      .neq('status', 'superseded')
      .not('promoted_object_id', 'is', null)
      .neq('kind', 'action'),
    captureIds.length > 0
      ? db.from('site_actions').select('id, title, status, priority, subject_thread_id').in('source_capture_id', captureIds).is('deleted_at', null)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string; status: string | null; priority: string | null; subject_thread_id: string | null }> }),
  ])

  const actionsById = new Map<string, { id: string; title: string; status: string | null; priority: string | null; subject_thread_id: string | null }>()
  for (const a of (actionsDirectRes.data ?? []) as Array<{ id: string; title: string; status: string | null; priority: string | null; subject_thread_id: string | null }>) actionsById.set(a.id, a)
  for (const a of (actionsCaptureRes.data ?? []) as Array<{ id: string; title: string; status: string | null; priority: string | null; subject_thread_id: string | null }>) actionsById.set(a.id, a)
  const actions = [...actionsById.values()]
  const proposals = (proposalsRes.data ?? []) as Array<{ id: string; kind: string; promoted_object_id: string; promoted_object_type: string | null; canonical_subject_id: string | null }>

  // ── PATH 1 : STI pour les actions ────────────────────────────────────────
  const threadIds = actions.map(a => a.subject_thread_id).filter((t): t is string => t != null)
  const stiMap = new Map<string, string>()  // thread_id → canonical_subject_id
  if (threadIds.length > 0) {
    const { data } = await db
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .in('subject_thread_id', threadIds)
    for (const r of (data ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>) {
      stiMap.set(r.subject_thread_id, r.canonical_subject_id)
    }
  }

  // ── LABELS DES SUJETS CANONIQUES ─────────────────────────────────────────
  const stiCsIds = [...stiMap.values()]
  const proposalCsIds = proposals.map(p => p.canonical_subject_id).filter((c): c is string => c != null)
  const allCsIds = [...new Set([...stiCsIds, ...proposalCsIds])]
  const csLabels = new Map<string, string>()
  if (allCsIds.length > 0) {
    const { data } = await db.from('canonical_subject').select('id, label').in('id', allCsIds)
    for (const r of (data ?? []) as Array<{ id: string; label: string }>) csLabels.set(r.id, r.label)
  }

  // ── PATH 2 : promoted_object_id → canonical_subject ──────────────────────
  const objToSubject = new Map<string, { csId: string | null; label: string | null }>()
  for (const p of proposals) {
    const csId = p.canonical_subject_id ?? null
    objToSubject.set(p.promoted_object_id, { csId, label: csId ? (csLabels.get(csId) ?? null) : null })
  }

  // ── FETCH DES OBJETS LIÉS À CETTE VISITE ─────────────────────────────────
  const [reservesRes, deadlinesRes, decisionsRes, knowledgeRes, watchpointsRes, intervenantsRes] = await Promise.all([
    db.from('site_reserve').select('id, label').eq('report_id', reportId),
    db.from('site_deadlines').select('id, title, due_date').eq('report_id', reportId).is('deleted_at', null),
    db.from('site_decisions').select('id, titre').eq('report_id', reportId),
    // Connaissances RETENUES uniquement (mémoire durable), jamais captured_knowledge
    // (donnée d'extraction) : un fait capté non retenu n'est pas un « objet produit ».
    db.from('site_knowledge_entries').select('id, title, kind').eq('source_report_id', reportId).eq('status', 'active').is('deleted_at', null),
    db.from('site_watchpoints').select('id, title').eq('report_id', reportId).is('deleted_at', null),
    db.from('site_intervenants').select('id, role, company_id, main_contact_id').eq('source_report_id', reportId),
  ])

  const resolve = (id: string) => {
    const s = objToSubject.get(id)
    return { canonicalSubjectId: s?.csId ?? null, subjectLabel: s?.label ?? null }
  }

  // ── LABELS DES INTERVENANTS OUVERTS PAR CETTE VISITE ─────────────────────
  const intervenants = (intervenantsRes.data ?? []) as Array<{ id: string; role: string; company_id: string | null; main_contact_id: string | null }>
  const companyIds = [...new Set(intervenants.map((i) => i.company_id).filter((x): x is string => !!x))]
  const contactIds = [...new Set(intervenants.map((i) => i.main_contact_id).filter((x): x is string => !!x))]
  const [companiesRes, contactsRes] = await Promise.all([
    companyIds.length > 0 ? db.from('companies').select('id, name, short_name').in('id', companyIds) : Promise.resolve({ data: [] }),
    contactIds.length > 0 ? db.from('company_contacts').select('id, full_name').in('id', contactIds) : Promise.resolve({ data: [] }),
  ])
  const companyById = new Map(((companiesRes.data ?? []) as Array<{ id: string; name: string; short_name: string | null }>).map((c) => [c.id, c]))
  const contactById = new Map(((contactsRes.data ?? []) as Array<{ id: string; full_name: string | null }>).map((c) => [c.id, c]))

  return groupVisitChanges({
    actions: actions.map(a => {
      const csId = a.subject_thread_id ? (stiMap.get(a.subject_thread_id) ?? null) : null
      return { id: a.id, title: a.title, status: a.status, priority: a.priority, canonicalSubjectId: csId, subjectLabel: csId ? (csLabels.get(csId) ?? null) : null }
    }),
    deadlines: ((deadlinesRes.data ?? []) as Array<{ id: string; title: string; due_date: string | null }>).map(d => ({ id: d.id, title: d.title, dueDate: d.due_date ?? null, ...resolve(d.id) })),
    knowledge: ((knowledgeRes.data ?? []) as Array<{ id: string; title: string; kind: string }>).map(f => ({ id: f.id, title: f.title, kind: f.kind, ...resolve(f.id) })),
    watchpoints: ((watchpointsRes.data ?? []) as Array<{ id: string; title: string }>).map(w => ({ id: w.id, title: w.title, ...resolve(w.id) })),
    decisions: ((decisionsRes.data ?? []) as Array<{ id: string; titre: string }>).map(d => ({ id: d.id, title: d.titre, ...resolve(d.id) })),
    reserves: ((reservesRes.data ?? []) as Array<{ id: string; label: string }>).map(r => ({ id: r.id, label: r.label, ...resolve(r.id) })),
    stakeholders: intervenants.map((i) => {
      const c = i.company_id ? companyById.get(i.company_id) : undefined
      const ct = i.main_contact_id ? contactById.get(i.main_contact_id) : undefined
      const label = c?.short_name || c?.name || ct?.full_name || 'non identifié'
      return { id: i.id, role: i.role, label, ...resolve(i.id) }
    }),
  })
}

export async function buildVisitNarrative(reportId: string): Promise<VisitNarrative | null> {
  const db = createAdminClient()

  const { data: visit } = await db
    .from('site_reports')
    .select('id, site_id, ended_at, debrief_analysis')
    .eq('id', reportId)
    .maybeSingle()
  if (!visit) return null
  const siteId = (visit as { site_id: string | null }).site_id
  const clotureAt = (visit as { ended_at: string | null }).ended_at
  // `generated_at` porte la date de la dernière synthèse ; sans analyse, aucune
  // pièce n'est « en retard » — il n'y a simplement rien eu à rattraper.
  const analyseAt =
    ((visit as { debrief_analysis: { generated_at?: string } | null }).debrief_analysis?.generated_at) ?? null

  const [caps, props, doc] = await Promise.all([
    db
      .from('visit_capture')
      .select('id, kind, body, created_at, captured_at, captured_at_source, lat, lng, status, triage_intent, attachment_id')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true }),
    db
      .from('site_knowledge_proposals')
      .select('id, kind, title, body, confidence, status, promoted_object_id, canonical_subject_id, source_capture_ids, created_at')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true }),
    getVisitCrDocument(reportId).catch(() => null),
  ])

  const captured: NarrativeCapture[] = ((caps.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: c.id as string,
    kind: c.kind as string,
    body: (c.body as string | null) ?? null,
    // L'instant RÉEL quand il est connu (import, EXIF) — sinon celui du dépôt.
    capturedAt: ((c.captured_at as string | null) ?? (c.created_at as string)),
    lat: (c.lat as number | null) ?? null,
    lng: (c.lng as number | null) ?? null,
    // Une capture écartée n'est pas retirée du récit : elle y figure comme
    // preuve, marquée. C'est ce qui permet de comprendre un choix six mois plus tard.
    kept: c.status !== 'discarded',
    intent: (c.triage_intent as string | null) ?? null,
    attachmentId: (c.attachment_id as string | null) ?? null,
    addedAt: c.created_at as string,
    addedAfterVisit: Boolean(clotureAt && (c.created_at as string) > clotureAt),
    sinceLastAnalysis: Boolean(analyseAt && (c.created_at as string) > analyseAt),
    dateSource: (c.captured_at_source as NarrativeCapture['dateSource']) ?? null,
    why: explainCapture({
      kept: c.status !== 'discarded',
      intent: (c.triage_intent as string | null) ?? null,
    }),
  }))

  const understood: NarrativeProposal[] = ((props.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
    id: p.id as string,
    type: p.kind as string,
    label: p.title as string,
    rationale: (p.body as string | null) ?? null,
    confidence: (p.confidence as number | null) ?? null,
    status: p.status as string,
    createdEntityId: (p.promoted_object_id as string | null) ?? null,
    canonicalSubjectId: (p.canonical_subject_id as string | null) ?? null,
    sourceCount: ((p.source_capture_ids as string[] | null) ?? []).length,
    why: explainProposal({ status: p.status as string }),
  }))

  // ── PRODUCED — la seule couche qui exige une PREUVE ───────────────────────
  const registry: RegistryEntry[] = (doc?.sections ?? []).flatMap((s) =>
    (s.concretisations ?? []).map((c) => ({ ...c, sourceSection: s.key })),
  )
  // `produced` = le journal, et rien d'autre. Les objets seulement rattachés
  // par `report_id` sont comptés à part : ils existent, mais rien ne prouve
  // qu'ils sont nés de ce récit.
  // La chaîne complète : objet → ligne du compte-rendu → phrase promue → capture.
  // Rien n'est deviné : sans promotion sur cette ligne, la réponse est null.
  const produced = classifyProduced(registry, []).map((p) => ({
    ...p,
    why: explainProduced(p),
    evidence: traceRegistryLine(
      doc?.sections.find((s) => s.key === p.sourceSection),
      p.itemKey,
      p.label,
    ),
  }))
  const linked = siteId ? await readReportLinked(reportId) : []
  const provenIds = new Set(produced.map((p) => `${p.kind}:${p.id}`))
  const historical = linked.filter((l) => !provenIds.has(`${l.kind}:${l.id}`))

  const correctedSections = (doc?.sections ?? [])
    .filter((s) => s.ai_content !== undefined && s.ai_content !== s.content)
    .map((s) => s.key)

  return {
    reportId,
    siteId,
    captured,
    understood,
    validated: {
      document: doc
        ? {
            id: doc.id,
            status: doc.status,
            validatedAt: (doc as unknown as { validated_at: string | null }).validated_at ?? null,
            validatedBy: (doc as unknown as { validated_by: string | null }).validated_by ?? null,
            reopenedAt: (doc as unknown as { reopened_at: string | null }).reopened_at ?? null,
            correctedSections,
          }
        : null,
      // 'fulfilled' compte ici AUSSI : la proposition a bien produit un objet
      // du chantier (mig 231). L'omettre laisserait des propositions comptées
      // nulle part — ni confirmées, ni écartées, ni en attente — et le total du
      // récit ne retomberait plus sur ses pieds. La NUANCE (qui a décidé) vit
      // dans le statut lui-même, pas dans ce compteur.
      confirmedProposals: understood.filter((p) => p.status === 'confirmed' || p.status === 'fulfilled').length,
      ignoredProposals: understood.filter((p) => p.status === 'dismissed').length,
      pendingProposals: understood.filter((p) => p.status === 'proposed').length,
      supersededProposals: understood.filter((p) => p.status === 'superseded').length,
      correctedSections,
      discardedCaptures: captured.filter((c) => !c.kept).length,
    },
    produced,
    historical,
    ignored: {
      byHuman: understood
        .filter((p) => p.status === 'dismissed')
        .map((p) => ({ id: p.id, label: p.label, type: p.type, why: p.why })),
      superseded: understood
        .filter((p) => p.status === 'superseded')
        .map((p) => ({ id: p.id, label: p.label, type: p.type, canonicalSubjectId: p.canonicalSubjectId, why: p.why })),
      captures: captured
        .filter((c) => !c.kept)
        .map((c) => ({ id: c.id, kind: c.kind, body: c.body, why: c.why })),
    },
    enrichment: {
      afterVisit: captured.filter((c) => c.addedAfterVisit).length,
      sinceLastAnalysis: captured.filter((c) => c.sinceLastAnalysis).length,
      lastAnalysisAt: analyseAt,
    },
    limits: { ...describeLimits(produced), historicalAttributions: historical.length },
  }
}

/** Les objets du chantier qui portent le `report_id` de cette visite. Aucun
 *  filtre de date : « pendant » n'est pas « par ». */
async function readReportLinked(reportId: string): Promise<ReportLinkedObject[]> {
  const db = createAdminClient()
  const [a, r, d, e, k, w] = await Promise.all([
    db.from('site_actions').select('id, title, created_at').eq('report_id', reportId),
    db.from('site_reserve').select('id, label, created_at').eq('report_id', reportId),
    db.from('site_decisions').select('id, titre, created_at').eq('report_id', reportId),
    db.from('site_deadlines').select('id, title, created_at').eq('report_id', reportId).is('deleted_at', null),
    db.from('captured_knowledge').select('id, title, created_at').eq('source_id', reportId),
    db.from('site_watchpoints').select('id, title, created_at').eq('report_id', reportId).is('deleted_at', null),
  ])
  const rows = (data: unknown, kind: ReportLinkedObject['kind'], field: string): ReportLinkedObject[] =>
    ((data ?? []) as Array<Record<string, unknown>>).map((x) => ({
      kind,
      id: x.id as string,
      label: (x[field] as string) ?? '',
      createdAt: (x.created_at as string | null) ?? null,
    }))
  return [
    ...rows(a.data, 'action', 'title'),
    ...rows(r.data, 'reserve', 'label'),
    ...rows(d.data, 'decision', 'titre'),
    ...rows(e.data, 'echeance', 'title'),
    ...rows(k.data, 'memoire', 'title'),
    ...rows(w.data, 'vigilance', 'title'),
  ]
}
