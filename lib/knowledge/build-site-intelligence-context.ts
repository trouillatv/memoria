import 'server-only'

// Assembleur canonique — Lot 4B
//
// Orchestre les services existants sans dupliquer leur logique métier.
// 100 % déterministe. Zéro LLM, zéro retrieval documentaire.
// Chaque élément conserve son identifiant d'origine (non négociable).
// Hiérarchie épistémique : rejected ne doit jamais alimenter ce contexte.

import { createAdminClient } from '@/lib/supabase/admin'
import { deriveSiteAttentionItems, type SiteAttentionItem } from '@/lib/knowledge/site-attention-items'
import { getNavigableSubjectsForSite, type NavigableSubjectSummary, type SubjectOpenSummary } from '@/lib/db/canonical-subject-life'
import { listConfirmedLinksForSite, type SubjectLinkType } from '@/lib/db/subject-thread-links'
import { getSiteIntervenantsView } from '@/lib/knowledge/site-intervenants-view'
import { listBlocagesBySite, type SiteBlocage } from '@/lib/db/site-blocages'
import { isProvenOpen, type PvState } from '@/lib/documents/subject-state'

// ── Types d'entrée ────────────────────────────────────────────────────────────

export interface SiteIntelligenceContextOptions {
  subjects?: boolean
  attention?: boolean
  activeObjects?: boolean
  relations?: boolean
  actors?: boolean
  timeline?: boolean
  blockages?: boolean
  maxSubjects?: number        // défaut : 20 (tri par priorité)
  maxRelations?: number       // défaut : 30
  maxActors?: number          // défaut : 15
  maxAttentionItems?: number  // défaut : 10
}

// ── Types de sortie ───────────────────────────────────────────────────────────

export interface IntelligenceSubjectItem {
  canonicalSubjectId: string
  title: string
  currentStatus: string | null
  currentTriState: PvState
  isProvenOpen: boolean
  firstSeenAt: string | null
  lastSeenAt: string | null
  lastMeaningfulChangeAt: string | null
  isStagnant: boolean
  stagnationDays: number
  activeObjects: NavigableSubjectSummary['activeObjects']
  terrainObjects: NavigableSubjectSummary['terrainObjects']
}

export interface IntelligenceRelationItem {
  linkId: string
  fromCanonicalSubjectId: string
  fromLabel: string
  linkType: SubjectLinkType
  toCanonicalSubjectId: string | null
  toLabel: string
  justification: string | null
}

export interface IntelligenceActorItem {
  intervenantId: string
  contactId: string | null
  name: string
  companyName: string
  role: string
  assignedActionsCount: number
  decisionsCount: number
  openObligationsCount: number
}

export interface IntelligenceOverdueAction {
  actionId: string
  title: string
  dueDate: string
  subjectThreadId: string | null
  canonicalSubjectId: string | null
  assignedTo: string | null
}

export interface IntelligenceOpenReserve {
  reserveId: string
  label: string
  issuedOn: string | null
}

export interface IntelligenceOverdueDeadline {
  deadlineId: string
  title: string
  dueDate: string
}

export interface IntelligenceActiveBlocage {
  blocageId: string
  title: string
  type: string
  dateStart: string
  description: string | null
}

export interface SiteActiveObjects {
  actionsEnRetard: IntelligenceOverdueAction[]
  reservesOuvertes: IntelligenceOpenReserve[]
  echeancesDepassees: IntelligenceOverdueDeadline[]
  blocagesActifs: IntelligenceActiveBlocage[]
  counts: {
    actionsEnRetard: number
    reservesOuvertes: number
    echeancesDepassees: number
    blocagesActifs: number
  }
}

export interface SiteIntelligenceContext {
  siteId: string
  siteName: string | null
  asOf: string
  subjects?: {
    items: IntelligenceSubjectItem[]
    total: number
    stagnantCount: number
    truncated: boolean
  }
  subjectsOpen?: {
    items: SubjectOpenSummary[]
    total: number
  }
  attention?: {
    items: SiteAttentionItem[]
    criticalCount: number
    highCount: number
    total: number
    truncated: boolean
  }
  activeObjects?: SiteActiveObjects
  relations?: {
    items: IntelligenceRelationItem[]
    total: number
    truncated: boolean
  }
  actors?: {
    items: IntelligenceActorItem[]
    total: number
    truncated: boolean
  }
  timeline?: {
    lastVisitAt: string | null
    lastVisitDaysAgo: number | null
  }
  blockages?: {
    active: IntelligenceActiveBlocage[]
    all: SiteBlocage[]
    activeCount: number
    totalCount: number
  }
  meta: {
    dataGaps: string[]
    retrievalNeeded: boolean
    dimensionsLoaded: string[]
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86400000)
}

function toBlocageItem(b: SiteBlocage): IntelligenceActiveBlocage {
  return { blocageId: b.id, title: b.title, type: b.type, dateStart: b.dateStart, description: b.description }
}

// ── Assembleur ────────────────────────────────────────────────────────────────

export async function buildSiteIntelligenceContext(
  siteId: string,
  options: SiteIntelligenceContextOptions = {},
): Promise<SiteIntelligenceContext> {
  const opts = {
    subjects: false,
    attention: false,
    activeObjects: false,
    relations: false,
    actors: false,
    timeline: false,
    blockages: false,
    maxSubjects: 20,
    maxRelations: 30,
    maxActors: 15,
    maxAttentionItems: 10,
    ...options,
  }

  const today = todayIso()
  const admin = createAdminClient()

  const needsBlockageData = opts.blockages || opts.activeObjects
  const needsThreadMap = opts.relations || opts.activeObjects

  // ── Phase 1 : toutes les requêtes parallèles ──────────────────────────────

  const [
    siteResult,
    attentionResult,
    subjectsResult,
    linksResult,
    intervenantsResult,
    blocagesResult,
    threadMappingsResult,
    overdueActionsResult,
    openReservesResult,
    overdueDeadlinesResult,
    lastVisitResult,
  ] = await Promise.all([
    admin.from('sites').select('name').eq('id', siteId).single() as unknown as Promise<{ data: { name: string } | null; error: unknown }>,

    opts.attention
      ? deriveSiteAttentionItems(siteId, today)
      : Promise.resolve(null),

    opts.subjects
      ? getNavigableSubjectsForSite(siteId)
      : Promise.resolve(null),

    opts.relations
      ? listConfirmedLinksForSite(siteId)
      : Promise.resolve(null),

    opts.actors
      ? getSiteIntervenantsView(siteId)
      : Promise.resolve(null),

    needsBlockageData
      ? listBlocagesBySite(siteId)
      : Promise.resolve(null),

    needsThreadMap
      ? (admin
          .from('subject_thread_identity')
          .select('subject_thread_id, canonical_subject_id')
          .eq('site_id', siteId) as unknown as Promise<{ data: Array<{ subject_thread_id: string; canonical_subject_id: string }> | null; error: unknown }>)
      : Promise.resolve(null),

    opts.activeObjects
      ? (admin
          .from('site_actions')
          .select('id, title, due_date, subject_thread_id, assigned_to')
          .eq('site_id', siteId)
          .eq('status', 'open')
          .not('due_date', 'is', null)
          .lt('due_date', today)
          .order('due_date', { ascending: true }) as unknown as Promise<{ data: Array<{ id: string; title: string; due_date: string; subject_thread_id: string | null; assigned_to: string | null }> | null; error: unknown }>)
      : Promise.resolve(null),

    opts.activeObjects
      ? (admin
          .from('site_reserve')
          .select('id, label, issued_on')
          .eq('site_id', siteId)
          .eq('status', 'open')
          .order('issued_on', { ascending: true, nullsFirst: false }) as unknown as Promise<{ data: Array<{ id: string; label: string; issued_on: string | null }> | null; error: unknown }>)
      : Promise.resolve(null),

    opts.activeObjects
      ? (admin
          .from('site_deadlines')
          .select('id, title, due_date')
          .eq('site_id', siteId)
          .in('status', ['to_plan', 'planned'])
          .not('due_date', 'is', null)
          .lt('due_date', today)
          .order('due_date', { ascending: true }) as unknown as Promise<{ data: Array<{ id: string; title: string; due_date: string }> | null; error: unknown }>)
      : Promise.resolve(null),

    opts.timeline
      ? (admin
          .from('site_reports')
          .select('ended_at')
          .eq('site_id', siteId)
          .not('ended_at', 'is', null)
          .order('ended_at', { ascending: false })
          .limit(1) as unknown as Promise<{ data: Array<{ ended_at: string }> | null; error: unknown }>)
      : Promise.resolve(null),
  ])

  // ── Carte thread → canonical (partagée entre relations et activeObjects) ──

  const threadToCs = new Map<string, string>()
  if (threadMappingsResult?.data) {
    for (const r of threadMappingsResult.data) {
      threadToCs.set(r.subject_thread_id, r.canonical_subject_id)
    }
  }

  // ── Carte canonical → label (pour enrichissement relations) ──────────────

  const canonicalToLabel = new Map<string, string>()
  if (subjectsResult) {
    for (const s of subjectsResult) canonicalToLabel.set(s.canonicalSubjectId, s.title)
  }

  // Phase 2 : enrichissement labels pour relations (uniquement si nécessaire)
  if (opts.relations && linksResult && linksResult.length > 0) {
    const canonicalIds = [
      ...new Set([
        ...linksResult.map((l) => threadToCs.get(l.fromThreadId)).filter((id): id is string => !!id),
        ...linksResult.map((l) => threadToCs.get(l.toThreadId)).filter((id): id is string => !!id),
      ]),
    ]
    const missing = canonicalIds.filter((id) => !canonicalToLabel.has(id))
    if (missing.length > 0) {
      const { data: csData } = await (admin
        .from('canonical_subject')
        .select('id, label')
        .in('id', missing) as unknown as Promise<{ data: Array<{ id: string; label: string }> | null }>)
      for (const r of csData ?? []) canonicalToLabel.set(r.id, r.label)
    }
  }

  // ── Assemblage des dimensions ─────────────────────────────────────────────

  const dataGaps: string[] = []
  const dimensionsLoaded: string[] = []

  // subjects
  let subjectsOut: SiteIntelligenceContext['subjects']
  let subjectsOpenOut: SiteIntelligenceContext['subjectsOpen']
  if (opts.subjects && subjectsResult) {
    dimensionsLoaded.push('subjects')
    const stagnantCount = subjectsResult.filter((s) => s.isStagnant).length
    const truncated = subjectsResult.length > opts.maxSubjects
    const items = subjectsResult.slice(0, opts.maxSubjects).map((s): IntelligenceSubjectItem => ({
      canonicalSubjectId: s.canonicalSubjectId,
      title: s.title,
      currentStatus: s.currentStatus,
      currentTriState: s.currentTriState,
      isProvenOpen: isProvenOpen(s.currentTriState, s.activeObjects.total),
      firstSeenAt: s.firstSeenAt,
      lastSeenAt: s.lastSeenAt,
      lastMeaningfulChangeAt: s.lastMeaningfulChangeAt,
      isStagnant: s.isStagnant,
      stagnationDays: s.stagnationDays,
      activeObjects: s.activeObjects,
      terrainObjects: s.terrainObjects,
    }))
    subjectsOut = { items, total: subjectsResult.length, stagnantCount, truncated }

    // subjectsOpen — sujets prouvés ouverts (tri-state=open OU objet actif), statuts clôturés exclus
    const CLOSED_FINAL = new Set(['done', 'cancelled', 'not_applicable'])
    const openItems: SubjectOpenSummary[] = subjectsResult
      .filter(s => !CLOSED_FINAL.has(s.currentStatus ?? '') && isProvenOpen(s.currentTriState, s.activeObjects.total))
      .map(s => ({ canonicalSubjectId: s.canonicalSubjectId, title: s.title, activeObjectsTotal: s.activeObjects.total }))
    subjectsOpenOut = { items: openItems, total: openItems.length }
  }

  // attention
  let attentionOut: SiteIntelligenceContext['attention']
  if (opts.attention && attentionResult) {
    dimensionsLoaded.push('attention')
    const criticalCount = attentionResult.filter((i) => i.urgency === 'critical').length
    const highCount = attentionResult.filter((i) => i.urgency === 'high').length
    const truncated = attentionResult.length > opts.maxAttentionItems
    attentionOut = {
      items: attentionResult.slice(0, opts.maxAttentionItems),
      criticalCount,
      highCount,
      total: attentionResult.length,
      truncated,
    }
  }

  // activeObjects
  let activeObjectsOut: SiteIntelligenceContext['activeObjects']
  if (opts.activeObjects) {
    dimensionsLoaded.push('activeObjects')
    const rawActions = overdueActionsResult?.data ?? []
    const rawReserves = openReservesResult?.data ?? []
    const rawDeadlines = overdueDeadlinesResult?.data ?? []
    const activeBlocages = (blocagesResult ?? []).filter((b) => b.dateEnd === null)

    const actionsEnRetard: IntelligenceOverdueAction[] = rawActions.map((a) => {
      const canonicalSubjectId = a.subject_thread_id ? (threadToCs.get(a.subject_thread_id) ?? null) : null
      if (a.subject_thread_id && !canonicalSubjectId) {
        dataGaps.push(`action ${a.id} — subject_thread_id sans mapping canonical`)
      }
      return {
        actionId: a.id,
        title: a.title,
        dueDate: a.due_date,
        subjectThreadId: a.subject_thread_id,
        canonicalSubjectId,
        assignedTo: a.assigned_to,
      }
    })

    activeObjectsOut = {
      actionsEnRetard,
      reservesOuvertes: rawReserves.map((r) => ({ reserveId: r.id, label: r.label, issuedOn: r.issued_on })),
      echeancesDepassees: rawDeadlines.map((d) => ({ deadlineId: d.id, title: d.title, dueDate: d.due_date })),
      blocagesActifs: activeBlocages.map(toBlocageItem),
      counts: {
        actionsEnRetard: actionsEnRetard.length,
        reservesOuvertes: rawReserves.length,
        echeancesDepassees: rawDeadlines.length,
        blocagesActifs: activeBlocages.length,
      },
    }
  }

  // relations
  let relationsOut: SiteIntelligenceContext['relations']
  if (opts.relations && linksResult) {
    dimensionsLoaded.push('relations')
    const seen = new Set<string>()
    const enriched: IntelligenceRelationItem[] = []

    for (const link of linksResult) {
      const fromCs = threadToCs.get(link.fromThreadId)
      if (!fromCs) { dataGaps.push(`link ${link.id} — fromThread sans canonical`); continue }

      const toCs = threadToCs.get(link.toThreadId) ?? null
      if (fromCs === toCs) continue  // self-loop canonique

      const key = `${fromCs}:${toCs ?? link.toThreadId}:${link.linkType}`
      if (seen.has(key)) continue
      seen.add(key)

      enriched.push({
        linkId: link.id,
        fromCanonicalSubjectId: fromCs,
        fromLabel: canonicalToLabel.get(fromCs) ?? 'Sujet inconnu',
        linkType: link.linkType,
        toCanonicalSubjectId: toCs,
        toLabel: (toCs ? canonicalToLabel.get(toCs) : null) ?? 'Sujet inconnu',
        justification: link.justification,
      })
    }

    const truncated = enriched.length > opts.maxRelations
    relationsOut = {
      items: enriched.slice(0, opts.maxRelations),
      total: enriched.length,
      truncated,
    }
  }

  // actors
  let actorsOut: SiteIntelligenceContext['actors']
  if (opts.actors) {
    dimensionsLoaded.push('actors')
    if (intervenantsResult === null) {
      dataGaps.push('intervenants non disponibles (hors org ou erreur)')
      actorsOut = { items: [], total: 0, truncated: false }
    } else {
      const allPeople = intervenantsResult.groups.flatMap((g) => g.people)
      const truncated = allPeople.length > opts.maxActors
      actorsOut = {
        items: allPeople.slice(0, opts.maxActors).map((p): IntelligenceActorItem => ({
          intervenantId: p.intervenantId,
          contactId: p.contactId,
          name: p.name,
          companyName: p.companyName,
          role: p.role,
          assignedActionsCount: p.assignedActions.length,
          decisionsCount: p.decisionsCount,
          openObligationsCount: p.openObligationsCount,
        })),
        total: allPeople.length,
        truncated,
      }
    }
  }

  // timeline
  let timelineOut: SiteIntelligenceContext['timeline']
  if (opts.timeline) {
    dimensionsLoaded.push('timeline')
    const lastVisitAt = lastVisitResult?.data?.[0]?.ended_at ?? null
    const lastVisitDaysAgo = lastVisitAt ? daysBetween(lastVisitAt, today) : null
    timelineOut = { lastVisitAt, lastVisitDaysAgo }
  }

  // blockages
  let blockagesOut: SiteIntelligenceContext['blockages']
  if (opts.blockages) {
    dimensionsLoaded.push('blockages')
    const all = blocagesResult ?? []
    const active = all.filter((b) => b.dateEnd === null).map(toBlocageItem)
    blockagesOut = { active, all, activeCount: active.length, totalCount: all.length }
  }

  return {
    siteId,
    siteName: siteResult.data?.name ?? null,
    asOf: today,
    subjects: subjectsOut,
    subjectsOpen: subjectsOpenOut,
    attention: attentionOut,
    activeObjects: activeObjectsOut,
    relations: relationsOut,
    actors: actorsOut,
    timeline: timelineOut,
    blockages: blockagesOut,
    meta: {
      dataGaps,
      retrievalNeeded: false,
      dimensionsLoaded,
    },
  }
}
