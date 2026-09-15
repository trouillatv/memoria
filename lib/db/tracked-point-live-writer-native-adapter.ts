// P6 Live Writer — second producteur réel (field_visit/meeting natif), rattachement CONFIRMED
// uniquement (P0-1A-1, mandat Vincent 2026-09-15, faisant suite à l'audit READ-ONLY comparant
// les 3 points d'accroche candidats sur runCanonicalReconciliation).
//
// Portée strictement bornée : rattache une mention native (canonical_subject_occurrence) à un
// Point/CBO DÉJÀ EXISTANT, quand le canonical_subject_id résolu de cette occurrence porte déjà
// EXACTEMENT un canonical_business_object. C'est le chemin CONFIRMED de decideFoundingOld
// (lib/knowledge/tracked-point-founding.ts) : celui-ci retourne CONFIRMED sans même regarder le
// contenu des proposals dès qu'un singleCboId existe — aucune traduction proposal_family/
// document_status n'est donc nécessaire pour ce lot.
//
// Explicitement HORS PÉRIMÈTRE : la fondation directe d'un Point tout neuf depuis une
// observation purement native (chemin PROVISIONAL auto-créé) — aucune branche de ce module
// n'appelle jamais planPointForUnit avec un kind autre que CONFIRMED/PENDING_TRACKABILITY, et
// PENDING_TRACKABILITY ne produit structurellement jamais de PlannedPoint (cf.
// tracked-point-write-plan.ts:planPointForUnit). Un sujet dont le canonical_subject_id porte
// plusieurs CBO (ambigu, jamais choisi au hasard ici) reste hors périmètre : problème
// d'identité distinct, pas de trackability — cf. P0-1A-2b, mandat Vincent 2026-09-15.
//
// P0-1A-2b (ce lot) — cas 0 CBO : un sujet sans CBO ne fonde jamais un Point ici, mais lorsqu'au
// moins une proposition native site_knowledge_proposals (kind≠'stakeholder', stakeholder hors
// périmètre par construction) résout à ce même thread, ce module produit un
// outcomeV2.kind='PENDING_TRACKABILITY' synthétique — jamais dérivé de proposal_family/
// document_status (schéma structurellement incompatible avec classifyTrackabilityContent,
// lib/knowledge/tracked-point-founding.ts, réservé à l'historique) — routé par
// reconcileTrackedPointUnit vers NEEDS_HUMAN/CREATE_PENDING_TRACE, exactement le même mécanisme
// que le chemin historique. Sans preuve utilisable (aucune occurrence de ce rapport reliée à une
// proposition non-stakeholder), le sujet est simplement ignoré : jamais d'invention d'état.
//
// Hook : appelé UNE FOIS par runCanonicalReconciliation (lib/visits/debrief-analysis.ts),
// immédiatement après que celle-ci ait retourné 'reconciled' — jamais sur 'already_done' /
// 'concurrent' / 'lock_lost' / 'failed'. Ce même point d'entrée est aussi rejoué tel quel par le
// cron de reprise (lib/db/reconciliation-sweep.ts), qui appelle runCanonicalReconciliation
// directement : jamais une variante appauvrie.
//
// canonical_business_object.canonical_subject_id est maintenu à jour (racine post-fusion) par
// projectCanonicalSubjectSafely, appelé juste avant dans le même runCanonicalReconciliation
// (point d'appel 4/4) : ce module peut donc l'interroger directement, sans reconstituer lui-même
// la résolution de fusion côté CBO.
//
// Ne fonde ni ne matérialise jamais d'objet, ne touche jamais promoteProposal ni le moteur
// d'identité : réutilise tel quel reconcileTrackedPointUnit (lib/db/tracked-point-live-writer.ts)
// avec une FoundingUnit synthétique scope='thread', props=[] — le contenu des proposals n'entre
// dans aucun calcul de la branche CONFIRMED (cf. decideFoundingOld, memberOf, foundingReferenceOf,
// buildFingerprint : tous ignorent `props` quand scope='thread').
//
// Rollout : comportement standard, plus de gate par site (P0-2B, mandat Vincent 2026-09-15,
// suppression de l'allowlist TRACKED_POINT_LIVE_WRITER_SITE_IDS — le Live Writer s'exécute
// systématiquement pour tout rapport éligible, existant ou futur).
//
// Frozen — voir docs/tracked-points/p6-live-writer-design.md (doctrine générale du writer).

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { FoundingUnit } from '@/lib/knowledge/tracked-point-founding'
import { reconcileTrackedPointUnit, type ReconcileVerdict } from '@/lib/db/tracked-point-live-writer'

type Db = ReturnType<typeof createAdminClient>

// ── Résolveur de sujet canonique — même doctrine que l'adaptateur historique
//    (tracked-point-live-writer-historical-adapter.ts:makeSubjectResolver), chargement paresseux
//    et mis en cache, jamais tout le site. Dupliqué plutôt que partagé : chaque adaptateur reste
//    un point de lecture live autonome et self-contained (même choix déjà fait côté historique).

type SubjectRow = { id: string; label: string; merged_into: string | null }

function makeSubjectResolver(db: Db, siteId: string) {
  const cache = new Map<string, SubjectRow>()

  async function ensureLoaded(id: string): Promise<void> {
    if (cache.has(id)) return
    const { data } = await db
      .from('canonical_subject')
      .select('id, label, merged_into')
      .eq('site_id', siteId)
      .eq('id', id)
      .maybeSingle()
    if (data) cache.set(id, data as SubjectRow)
  }

  async function resolveRoot(id: string | null): Promise<string | null> {
    if (!id) return null
    let cur = id
    const seen = new Set<string>()
    while (!seen.has(cur)) {
      seen.add(cur)
      await ensureLoaded(cur)
      const row = cache.get(cur)
      if (!row?.merged_into) return cur
      cur = row.merged_into
    }
    return cur
  }

  async function labelOf(id: string | null): Promise<string | null> {
    if (!id) return null
    await ensureLoaded(id)
    return cache.get(id)?.label ?? null
  }

  return { resolveRoot, labelOf }
}

export type NativeLiveWriterRunResult = {
  unitsProcessed: number
  verdictCounts: Partial<Record<ReconcileVerdict, number>>
  refusals: number
  /** Sujets mentionnés par ce rapport dont le CBO n'est pas déterminable (0 ou >1) ET, pour le
   *  cas 0, sans preuve native utilisable (aucune site_knowledge_proposals non-stakeholder liée) —
   *  jamais traités au-delà, ni CONFIRMED ni PENDING_TRACKABILITY. Le cas >1 reste toujours ici
   *  (ambiguïté d'identité, hors périmètre par construction). */
  skippedNotConfirmed: number
}

/**
 * Point d'entrée unique câblé par runCanonicalReconciliation, juste après un outcome
 * 'reconciled'. Retourne `null` si aucune occurrence n'existe pour ce rapport — distinct d'un
 * run ayant tourné mais sans unité CONFIRMED.
 *
 * Best-effort côté appelant : cette fonction laisse remonter ses exceptions (même doctrine que
 * l'adaptateur historique) — l'appelant est responsable du try/catch.
 */
export async function runTrackedPointLiveWriterForNativeReport(params: {
  reportId: string
  siteId: string
}): Promise<NativeLiveWriterRunResult | null> {
  const { reportId, siteId } = params

  const db = createAdminClient()

  const { data: occRows } = await db
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, source_kind, source_proposal_id')
    .eq('site_id', siteId)
    .eq('source_ref_id', reportId)
  const occurrences = (occRows ?? []) as Array<{
    canonical_subject_id: string
    source_kind: string
    source_proposal_id: string | null
  }>
  if (occurrences.length === 0) {
    return { unitsProcessed: 0, verdictCounts: {}, refusals: 0, skippedNotConfirmed: 0 }
  }

  const resolver = makeSubjectResolver(db, siteId)

  // Un sujet racine par occurrence — sourceKind conservé par racine (un rapport est en pratique
  // soit field_visit soit meeting ; on garde le premier rencontré si jamais deux occurrences du
  // même rapport divergeaient). proposalIdsByRoot : toutes les site_knowledge_proposals
  // (source_proposal_id, mig 291) reliées à ce rapport pour ce sujet — matière première du
  // contrôle de preuve native du cas 0 CBO (P0-1A-2b), jamais utilisée pour le cas CONFIRMED.
  const sourceKindByRoot = new Map<string, 'field_visit' | 'meeting'>()
  const proposalIdsByRoot = new Map<string, Set<string>>()
  for (const occ of occurrences) {
    const root = await resolver.resolveRoot(occ.canonical_subject_id)
    if (!root) continue
    if (!sourceKindByRoot.has(root)) {
      sourceKindByRoot.set(root, occ.source_kind === 'meeting' ? 'meeting' : 'field_visit')
    }
    if (occ.source_proposal_id) {
      const set = proposalIdsByRoot.get(root) ?? new Set<string>()
      set.add(occ.source_proposal_id)
      proposalIdsByRoot.set(root, set)
    }
  }
  const roots = [...sourceKindByRoot.keys()]
  if (roots.length === 0) {
    return { unitsProcessed: 0, verdictCounts: {}, refusals: 0, skippedNotConfirmed: 0 }
  }

  const { data: cboRows } = await db
    .from('canonical_business_object')
    .select('id, label, canonical_subject_id')
    .eq('site_id', siteId)
    .in('canonical_subject_id', roots)
  const cbosByRoot = new Map<string, Array<{ id: string; label: string }>>()
  for (const c of (cboRows ?? []) as Array<{ id: string; label: string; canonical_subject_id: string | null }>) {
    if (!c.canonical_subject_id) continue
    const list = cbosByRoot.get(c.canonical_subject_id) ?? []
    list.push({ id: c.id, label: c.label })
    cbosByRoot.set(c.canonical_subject_id, list)
  }

  // Preuve native du cas 0 CBO (P0-1A-2b) : jamais dérivée de site_knowledge_proposals.status
  // (proposed/confirmed/dismissed/superseded décrit le cycle de la proposition, pas l'état réel
  // du problème — doctrine posée en 2a) — seule l'EXISTENCE d'une proposition non-stakeholder
  // reliée au thread compte. stakeholder reste hors périmètre par construction (mandat 2b).
  const zeroCboRoots = roots.filter((root) => (cbosByRoot.get(root) ?? []).length === 0)
  const candidateProposalIds = [...new Set(zeroCboRoots.flatMap((root) => [...(proposalIdsByRoot.get(root) ?? [])]))]
  const trackableProposalIdsByRoot = new Map<string, string[]>()
  if (candidateProposalIds.length > 0) {
    const { data: skpRows } = await db
      .from('site_knowledge_proposals')
      .select('id, kind')
      .in('id', candidateProposalIds)
    const trackableIds = new Set(
      ((skpRows ?? []) as Array<{ id: string; kind: string }>)
        .filter((p) => p.kind !== 'stakeholder')
        .map((p) => p.id),
    )
    for (const root of zeroCboRoots) {
      const ids = [...(proposalIdsByRoot.get(root) ?? [])].filter((id) => trackableIds.has(id))
      if (ids.length > 0) trackableProposalIdsByRoot.set(root, ids)
    }
  }

  const verdictCounts: Partial<Record<ReconcileVerdict, number>> = {}
  let refusals = 0
  let skippedNotConfirmed = 0
  let unitsProcessed = 0

  // Séquentiel et délibéré, même doctrine que l'adaptateur historique : la RPC verrouille par
  // Point (FOR UPDATE), plusieurs sujets de ce rapport peuvent viser le même Point candidat.
  for (const root of roots) {
    const cbos = cbosByRoot.get(root) ?? []

    let unit: FoundingUnit
    let ctx: { cboLabel?: string | null; canonicalSubjectId: string; canonicalSubjectLabel: string | null }

    if (cbos.length === 1) {
      const cbo = cbos[0]
      const subjectLabel = await resolver.labelOf(root)
      unit = {
        threadId: root,
        scope: 'thread',
        props: [],
        families: [],
        threadLabel: subjectLabel ?? cbo.label,
        outcomeOld: 'CONFIRMED',
        outcomeV2: { kind: 'CONFIRMED', cboId: cbo.id },
      }
      ctx = { cboLabel: cbo.label, canonicalSubjectId: root, canonicalSubjectLabel: subjectLabel }
    } else if (cbos.length === 0) {
      const evidenceIds = trackableProposalIdsByRoot.get(root)
      if (!evidenceIds || evidenceIds.length === 0) {
        skippedNotConfirmed += 1
        continue
      }
      const subjectLabel = await resolver.labelOf(root)
      unit = {
        threadId: root,
        scope: 'thread',
        props: [],
        families: [],
        threadLabel: subjectLabel ?? '(sujet sans libellé)',
        outcomeOld: 'UNCOVERED_FAMILY_COMBINATION',
        outcomeV2: { kind: 'PENDING_TRACKABILITY' },
      }
      ctx = { canonicalSubjectId: root, canonicalSubjectLabel: subjectLabel }
    } else {
      // Ambigu (>1 CBO) : problème d'identité, jamais de choix au hasard — hors périmètre 2b.
      skippedNotConfirmed += 1
      continue
    }

    const result = await reconcileTrackedPointUnit({
      siteId,
      unit,
      ctx,
      sourceKind: sourceKindByRoot.get(root)!,
      sourceRefId: reportId,
    })
    unitsProcessed += 1
    if (result.ok) {
      verdictCounts[result.verdict] = (verdictCounts[result.verdict] ?? 0) + 1
    } else {
      refusals += 1
      console.error('[tracked-point-live-writer-native-adapter] reconcile refused:', result.error)
    }
  }

  return { unitsProcessed, verdictCounts, refusals, skippedNotConfirmed }
}
