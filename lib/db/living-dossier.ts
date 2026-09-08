// lib/db/living-dossier.ts
// LE DOSSIER VIVANT — CONTRAT DE LECTURE canonique d'un point suivi (Vincent 2026-06-28).
//
// « Porte RF30 » n'est pas une fiche, c'est une histoire. Une seule fonction pour
// TOUTES les surfaces (briefing, visite, atelier IA, dossier de reprise) → une seule
// version de la vérité, jamais cinq reconstructions divergentes.
//
// SÉPARATION STRICTE (sinon poubelle de données) :
//   • CONTRAT SÉMANTIQUE (champs du haut) = ce que lisent les surfaces métier :
//     où on en est / l'histoire / sur quoi on s'appuie / ce qui reste ouvert / la suite.
//   • `detail` = le SUBSTRAT brut (thread/insights), réservé à la page DÉTAILLÉE.
// Les surfaces métier lisent le contrat ; seule la page détaillée lit `detail`.
//
// `nextSteps` = DÉTERMINISTE pour l'instant (échéances + actions ouvertes), PAS « ce
// que l'IA pense » — l'inférence viendra plus tard (gated). Cf. [[vue-sujet-unite-memoire]],
// [[continuite-operationnelle-2026-05-22]].

import { createAdminClient } from '@/lib/supabase/admin'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import {
  getSubjectThread,
  getSubjectTimeline,
  getSubjectInsights,
  type SubjectThread,
  type SubjectEvent,
  type SubjectInsights,
} from '@/lib/db/subjects'
import { getSubjectRelations } from '@/lib/db/subject-relations'
import { listCapturedKnowledgeBySubject, type CapturedKnowledgeRow } from '@/lib/db/captured-knowledge'
import { listVisitCapturesBySubject, listVisitCapturesByTrackedPointIds, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { loadTrackedPointReadModel, resolveTrackedPointIdsForSubject } from '@/lib/knowledge/tracked-point-read-model'

export type OpenLoopKind = 'action' | 'reserve' | 'obligation' | 'promise'
export interface OpenLoop { kind: OpenLoopKind; label: string }
export interface DossierNextStep { label: string; due: string | null }
export interface DossierCurrentState {
  /** Situation MÉTIER, dérivée du moteur UNIQUE computeSubjectInsights
   *  (ouvert/en_attente/bloqué/dormant/clos) — pas de re-dérivation parallèle. */
  state: string
  /** Pourquoi on en est là (cause déduite), null si non déduite. */
  cause: string | null
  /** Statut de cycle de vie brut du point (open/dormant/closed). */
  lifecycle: string
  lastActivity: string | null    // date de la dernière trace
  openCount: number              // nombre de boucles ouvertes
}
export interface DossierEvidence {
  captures: number
  verifications: number
  photos: number
  vocals: number
  documents: number
}

export interface LivingDossier {
  // ── Contrat sémantique stable (les surfaces métier lisent ICI) ──
  identity: NonNullable<Awaited<ReturnType<typeof getSiteIdentity>>>
  currentState: DossierCurrentState
  timeline: SubjectEvent[]
  evidence: DossierEvidence
  openLoops: OpenLoop[]
  nextSteps: DossierNextStep[]
  relations: Awaited<ReturnType<typeof getSubjectRelations>>
  // ── Substrat brut (réservé aux écrans détaillés) ──
  detail: {
    thread: SubjectThread
    insights: SubjectInsights | null
    capturedKnowledge: CapturedKnowledgeRow[]
    visitCaptures: VisitCaptureRow[]
  }
}

/**
 * Assemble le dossier vivant d'un point suivi. Renvoie null si le point n'existe
 * pas ou n'appartient pas au site. Lecture seule, zéro écriture. Toutes les
 * dérivations sont DÉTERMINISTES (zéro IA).
 */
export async function getLivingDossier(siteId: string, subjectId: string): Promise<LivingDossier | null> {
  const [identity, thread, timeline, insights, relations, capturedKnowledge, subjectVisitCaptures, linkedPointIds] = await Promise.all([
    getSiteIdentity(siteId),
    getSubjectThread(subjectId),
    getSubjectTimeline(subjectId, siteId),
    getSubjectInsights(subjectId),
    getSubjectRelations(subjectId),
    listCapturedKnowledgeBySubject(subjectId).catch(() => []),
    listVisitCapturesBySubject(subjectId).catch(() => []),
    resolveTrackedPointIdsForSubject(siteId, subjectId).catch(() => []),
  ])

  if (!identity || !thread || thread.subject.site_id !== siteId) return null

  // Points suivis (mig 397, mandat A) : un Point rattaché à ce sujet legacy via
  // canonical_subject_id peut porter des captures 'tracked_point_id'-only (jamais
  // subject_id). Sans cette union elles seraient invisibles ici alors que visibles
  // dans listVisitTouchedDossiers — élargi au composant de fusion entier (mandat B).
  const pointVisitCaptures = linkedPointIds.length > 0
    ? await listVisitCapturesByTrackedPointIds(linkedPointIds).catch(() => [])
    : []
  const visitCaptures = [...subjectVisitCaptures, ...pointVisitCaptures]

  // ── openLoops : tout ce qui reste OUVERT sur ce point ──
  const openLoops: OpenLoop[] = []
  for (const a of thread.actions) {
    if (a.status === 'open' || a.status === 'planned') openLoops.push({ kind: 'action', label: a.title })
  }
  for (const r of thread.reserves) {
    if (r.status === 'open') openLoops.push({ kind: 'reserve', label: r.label })
  }
  for (const e of timeline) {
    if (e.kind === 'obligation' && /produire|en cours/i.test(e.meta ?? '')) openLoops.push({ kind: 'obligation', label: e.label })
  }
  for (const k of capturedKnowledge) {
    if (k.kind === 'promise' && k.status === 'active') openLoops.push({ kind: 'promise', label: k.title })
  }

  // ── nextSteps : DÉTERMINISTE = actions ouvertes, échéances d'abord ──
  const nextSteps: DossierNextStep[] = thread.actions
    .filter((a) => a.status === 'open' || a.status === 'planned')
    .map((a) => ({ label: a.title, due: a.due_date ?? null }))
    .sort((x, y) => (x.due ?? '9999-12-31').localeCompare(y.due ?? '9999-12-31'))

  // ── evidence : sur quoi le point s'appuie ──
  const evidence: DossierEvidence = {
    captures: visitCaptures.length,
    verifications: visitCaptures.filter((c) => c.kind === 'verification').length,
    photos: visitCaptures.filter((c) => c.kind === 'photo').length,
    vocals: visitCaptures.filter((c) => c.kind === 'vocal').length,
    documents: thread.documents.length,
  }

  // ── currentState : la SITUATION lue du moteur unique (computeSubjectInsights),
  //    jamais re-dérivée ici. C'est la même vérité que la page point suivi et le brief. ──
  const lastActivity = timeline.length > 0 ? timeline[timeline.length - 1].date : null
  const currentState: DossierCurrentState = {
    state: insights?.state ?? 'ouvert',
    cause: insights?.cause?.text ?? null,
    lifecycle: thread.subject.status as string,
    lastActivity,
    openCount: openLoops.length,
  }

  return {
    identity,
    currentState,
    timeline,
    evidence,
    openLoops,
    nextSteps,
    relations,
    detail: { thread, insights, capturedKnowledge, visitCaptures },
  }
}

// ── Lecture LÉGÈRE : les dossiers TOUCHÉS par une visite ─────────────────────
// Pour le débrief : « tu as vérifié ces points aujourd'hui — voici où en sont
// leurs dossiers ». Lit le MÊME moteur (getSubjectInsights = ce que getLivingDossier
// enveloppe), batché — pas N× getLivingDossier complet (timeline/relations/detail).

export interface VisitTouchedDossier {
  id: string
  name: string
  state: string
  cause: string | null
  openActions: number
  openReserves: number
  openQuestion: string | null
}

export async function listVisitTouchedDossiers(reportId: string): Promise<VisitTouchedDossier[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('visit_capture')
    .select('subject_id, tracked_point_id, site_id')
    .eq('report_id', reportId)
    .neq('status', 'discarded')
  const rows = (data ?? []) as Array<{ subject_id: string | null; tracked_point_id: string | null; site_id: string }>
  const ids = [...new Set(rows.map((r) => r.subject_id).filter((x): x is string => !!x))]
  const pointIds = [...new Set(rows.map((r) => r.tracked_point_id).filter((x): x is string => !!x))]
  const siteId = rows[0]?.site_id ?? null

  const subjectDossiers: VisitTouchedDossier[] = []
  if (ids.length > 0) {
    const { data: subjRows } = await supabase.from('subjects').select('id, name').in('id', ids)
    const nameById = new Map(((subjRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]))
    const insightsList = await Promise.all(ids.map((id) => getSubjectInsights(id).catch(() => null)))
    ids.forEach((id, i) => {
      const ins = insightsList[i]
      subjectDossiers.push({
        id,
        name: nameById.get(id) ?? '—',
        state: ins?.state ?? 'ouvert',
        cause: ins?.cause?.text ?? null,
        openActions: ins?.openActions ?? 0,
        openReserves: ins?.openReserves ?? 0,
        openQuestion: ins?.openQuestion ?? null,
      })
    })
  }

  // Points suivis (mig 397) : pas de moteur d'insights (cause/openActions/
  // openReserves/openQuestion) équivalent à computeSubjectInsights — construire
  // cet équivalent est un chantier séparé (cf. HARD STOP POINT VERIFY MIGRATION).
  // On expose ici uniquement ce que le read-model calcule réellement : le libellé
  // et l'état dérivé (open/reopened/conflict/unknown/resolved), sans inventer de cause.
  const pointDossiers: VisitTouchedDossier[] = []
  if (pointIds.length > 0 && siteId) {
    const { points } = await loadTrackedPointReadModel(siteId)
    const byId = new Map(points.map((p) => [p.id, p]))
    for (const pid of pointIds) {
      const p = byId.get(pid)
      if (!p) continue
      pointDossiers.push({
        id: p.id,
        name: p.label,
        state: p.derivedState,
        cause: null,
        openActions: 0,
        openReserves: 0,
        openQuestion: null,
      })
    }
  }

  return [...subjectDossiers, ...pointDossiers]
}
