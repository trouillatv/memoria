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
    superseded: Array<{ id: string; label: string; type: string; why: Reason }>
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
      .select('id, kind, title, body, confidence, status, promoted_object_id, created_at')
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
      confirmedProposals: understood.filter((p) => p.status === 'confirmed').length,
      ignoredProposals: understood.filter((p) => p.status === 'dismissed').length,
      pendingProposals: understood.filter((p) => p.status === 'proposed').length,
      supersededProposals: understood.filter((p) => p.status === 'superseded').length,
      correctedSections,
      discardedCaptures: captured.filter((c) => !c.kept).length,
    },
    produced,
    ignored: {
      byHuman: understood
        .filter((p) => p.status === 'dismissed')
        .map((p) => ({ id: p.id, label: p.label, type: p.type, why: p.why })),
      superseded: understood
        .filter((p) => p.status === 'superseded')
        .map((p) => ({ id: p.id, label: p.label, type: p.type, why: p.why })),
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
  const [a, r, d, e, k] = await Promise.all([
    db.from('site_actions').select('id, title, created_at').eq('report_id', reportId),
    db.from('site_reserve').select('id, label, created_at').eq('report_id', reportId),
    db.from('site_decisions').select('id, titre, created_at').eq('report_id', reportId),
    db.from('site_deadlines').select('id, title, created_at').eq('report_id', reportId).is('deleted_at', null),
    db.from('captured_knowledge').select('id, title, created_at').eq('source_id', reportId),
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
  ]
}
