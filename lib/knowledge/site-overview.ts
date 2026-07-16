import 'server-only'

// ── READ MODEL : SiteOverview ────────────────────────────────────────────────
// LE CONTRAT PUBLIC de la connaissance d'un chantier pour l'écran « Aperçu » (fiche
// chantier desktop + mobile). Les composants ne connaissent QUE ce type — jamais
// ActionProjection / ProposalProjection / les tables. Il COMPOSE les projections
// métier (proposé) et les repositories (validé) ; il ne contient aucune mutation et
// n'accède pas directement à Supabase (il passe par la couche projection/repository).
//
// Règle de forme : JAMAIS `undefined`. Chaque section existe toujours, avec des
// tableaux vides et des compteurs à 0 → les composants sont quasiment sans `if`.
//
// NB : le « ici et maintenant » terrain (visites du jour, captures en attente,
// présence) N'EST PAS ici — il vit dans un read model distinct `getSiteFieldToday`
// (mobile), pour que SiteOverview ne grossisse pas pour un seul écran.

import { getSiteProjection, emptySiteProjection, type ProposalProjection } from '@/lib/knowledge/projection'
import {
  readSiteActionSummaries,
  readLatestVisitSynthesis,
  readVisitSourceSnapshot,
  type ActionSummaryRow,
} from '@/lib/knowledge/repository'
import { computeSnapshotDelta, countSnapshotDelta, type SnapshotDelta } from '@/lib/visits/source-snapshot'
import { getSiteIdentity, listSiteASavoirActive } from '@/lib/db/sites'
import { listSiteIntervenants } from '@/lib/db/site-intervenants'
import { getSiteRecentActivity, buildSiteStatusSummary } from '@/lib/db/visits'
import { listBlocagesBySite } from '@/lib/db/site-blocages'
import { buildSiteMemorySignals, type MemorySignal } from '@/lib/db/site-memory-signals'
import {
  getSiteCurrentState,
  getSiteRecentActivity as getSiteCockpitActivity,
  type RecentActivityItem,
} from '@/lib/db/site-cockpit'
import {
  buildOverviewAttention,
  selectNextEvent,
  selectPriorityActions,
  selectRecentChanges,
  getActionDueLabel,
  type OverviewSignalInput,
  type OverviewChangeInput,
  type OverviewEventInput,
} from '@/lib/chantier/overview-projections'

const TOP = 3
const HISTORY_LIMIT = 5
const ACTIVITY_LIMIT = 12
/** Un verrou de génération plus vieux que ça est considéré comme abandonné (cf. débrief). */
const GENERATING_LEASE_MS = 120_000

export interface KnowledgeItem { id: string; title: string }
export interface HistoryItem { id: string; label: string; at: string; kind: string; href: string; detail: string | null }

// ── Attention ────────────────────────────────────────────────────────────────
// JAMAIS un niveau opaque : l'écran doit pouvoir dire POURQUOI le chantier réclame
// de l'attention. `level` ne sert qu'à la mise en forme ; `reasons` porte le sens,
// et chaque raison NOMME le fait (l'action en retard, le blocage), avec son lien.
// 'urgent' est réservé à un FAIT DÉCLARÉ (un blocage) — jamais une inférence.
export type AttentionLevel = 'calm' | 'watch' | 'urgent'
export type AttentionKind =
  | 'blocage_active'
  | 'reserve_critical'
  | 'action_overdue'
  | 'reserve_old'
  | 'deadline_imminent'
  | 'event_upcoming'
export interface AttentionReason {
  id: string
  kind: AttentionKind
  title: string
  detail: string | null
  href: string | null
}

/** Urgence d'une action — sens métier ; la couleur est l'affaire de l'écran. */
export type ActionUrgency = 'late' | 'today' | 'week' | 'later' | 'undated'
export interface PriorityAction {
  id: string
  title: string
  href: string | null
  dueLabel: string
  urgency: ActionUrgency
}

export type OverviewEventKind = 'visit' | 'meeting' | 'intervention'
export interface OverviewEvent {
  id: string
  kind: OverviewEventKind
  title: string
  startsAt: string
  detail: string | null
  href: string | null
}

export interface OverviewChange {
  id: string
  title: string
  occurredAt: string
  detail: string | null
  href: string | null
}

/** Section uniforme d'un objet de connaissance : proposé (à confirmer) vs validé.
 *  `summary` (explicite) plutôt que `counts` (opaque). */
export interface KnowledgeSection {
  proposed: KnowledgeItem[]
  confirmed: KnowledgeItem[]
  summary: { proposed: number; confirmed: number }
}

/** L'objet Action a un résumé métier plus riche (actives / retard / terminées). */
// « Actives » = open + planned : une action planifiée compte toujours dans la charge
// du chantier. « planned » est exposé à part pour dire « dont N planifiées » — les
// deux notions sont utiles, elles ne doivent pas être confondues.
export interface ActionsSection {
  proposed: KnowledgeItem[]
  confirmed: KnowledgeItem[] // actions actives (open/planned)
  priority: PriorityAction[]
  summary: { proposed: number; active: number; planned: number; overdue: number; completed: number }
}

export type SynthesisStatus = 'missing' | 'up_to_date' | 'outdated' | 'generating'

export interface SiteOverview {
  /** CE QU'EST le chantier — stable, ne bouge pas parce qu'on l'a visité. */
  identity: {
    id: string
    name: string
    client: string | null
    status: string | null
  }
  /** CE QUI LUI ARRIVE — vie du chantier. Séparé de l'identité, qui n'est pas un fourre-tout. */
  activity: {
    lastVisit: { reportId: string; endedAt: string | null } | null
    picture: string | null
  }
  // La synthèse est la « mémoire IA » du chantier — un objet métier à part entière.
  synthesis: {
    status: SynthesisStatus
    version: number | null
    updatedAt: string | null
    /** Empreinte du corpus sur lequel la synthèse a été faite. */
    basedOn: string | null
    /** Éléments ajoutés à la visite DEPUIS la synthèse (0 = à jour). */
    pendingChanges: number
    /** Le détail de ce qui a été ajouté — « +1 note », « +2 photos ». */
    pending: SnapshotDelta
  }
  actions: ActionsSection
  attention: { level: AttentionLevel; reasons: AttentionReason[] }
  nextEvent: OverviewEvent | null
  recentChanges: OverviewChange[]
  reserves: { open: number }
  blockages: { open: number }
  watchpoints: KnowledgeSection
  deadlines: KnowledgeSection
  stakeholders: KnowledgeSection
  knowledge: KnowledgeSection
  history: HistoryItem[]
}

/** Section « proposé seul » (objet validé pas encore modélisé, ex. vigilances). */
function proposedOnly(p: ProposalProjection): KnowledgeSection {
  return { proposed: p.proposedTop.slice(0, TOP), confirmed: [], summary: { proposed: p.proposed, confirmed: 0 } }
}

/** Section « proposé + validé ». */
function proposedAndConfirmed(p: ProposalProjection, confirmed: KnowledgeItem[], confirmedTotal: number): KnowledgeSection {
  return {
    proposed: p.proposedTop.slice(0, TOP),
    confirmed: confirmed.slice(0, TOP),
    summary: { proposed: p.proposed, confirmed: confirmedTotal },
  }
}

/** Urgence métier d'une action — même règle que le libellé d'échéance. */
function urgencyOf(dueDate: string | null, todayIso: string): ActionUrgency {
  if (!dueDate) return 'undated'
  const due = dueDate.slice(0, 10)
  if (due < todayIso) return 'late'
  if (due === todayIso) return 'today'
  const days = Math.floor((Date.parse(`${due}T00:00:00.000Z`) - Date.parse(`${todayIso}T00:00:00.000Z`)) / 86_400_000)
  return days <= 7 ? 'week' : 'later'
}

/** Un blocage est un fait DÉCLARÉ : lui seul rend le chantier « urgent ». */
function attentionLevelOf(reasons: AttentionReason[]): AttentionLevel {
  if (reasons.length === 0) return 'calm'
  return reasons.some((r) => r.kind === 'blocage_active') ? 'urgent' : 'watch'
}

function toBlocageReasons(blocages: Array<{ id: string; title: string; impact: string | null; description: string | null }>, siteId: string): OverviewSignalInput[] {
  return blocages.map((b) => ({
    id: `blocage-${b.id}`,
    kind: 'blocage_active' as const,
    title: b.title,
    detail: b.impact ?? b.description ?? 'Blocage en cours',
    href: `/sites/${siteId}/reserves`,
  }))
}

function toMemoryReasons(signals: MemorySignal[], siteId: string): OverviewSignalInput[] {
  return signals.flatMap<OverviewSignalInput>((signal) => {
    if (signal.kind === 'action_overdue') {
      return signal.items.slice(0, 2).map((item) => ({
        id: `action-${item.id}`,
        kind: 'action_overdue' as const,
        title: item.label,
        detail: item.meta ?? signal.title,
        href: `/sites/${siteId}/actions`,
      }))
    }
    if (signal.kind === 'reserve_open') {
      return signal.items.slice(0, 2).map((item) => ({
        id: `reserve-${item.id}`,
        kind: 'reserve_old' as const,
        title: item.label,
        detail: item.meta ?? signal.title,
        href: `/sites/${siteId}/reserves`,
      }))
    }
    if (signal.kind === 'proof_window_closing' || signal.kind === 'obligation_neglected') {
      return [{
        id: `${signal.kind}-${signal.items[0]?.id ?? signal.title}`,
        kind: 'deadline_imminent' as const,
        title: signal.title,
        detail: signal.items[0]?.label ?? null,
        href: null,
      }]
    }
    return []
  })
}

function toOverdueActionReasons(rows: ActionSummaryRow[], todayIso: string, siteId: string): OverviewSignalInput[] {
  return rows
    .filter((a) => a.due_date && a.due_date.slice(0, 10) < todayIso)
    .slice(0, 2)
    .map((a) => ({
      id: `late-${a.id}`,
      kind: 'action_overdue' as const,
      title: a.title,
      detail: getActionDueLabel({ dueDate: a.due_date, status: a.status }, todayIso),
      href: `/sites/${siteId}/actions`,
    }))
}

function toChangeInputs(items: RecentActivityItem[]): OverviewChangeInput[] {
  return items.map((item) => ({
    id: `${item.kind}-${item.id}`,
    kind: item.kind === 'anomaly'
      ? 'reserve_created'
      : item.kind === 'intervention'
        ? 'intervention_done'
        : item.kind === 'photo' || item.kind === 'voice_note'
          ? 'important_document_added'
          : 'note_added',
    title: item.primary,
    detail: item.secondary,
    occurredAt: item.occurredAt,
    href: item.interventionId ? `/interventions/${item.interventionId}` : null,
  }))
}

function toEventInputs(nextScheduledAt: string | null, slot: string | null, siteId: string): OverviewEventInput[] {
  if (!nextScheduledAt) return []
  return [{
    id: nextScheduledAt,
    kind: 'intervention',
    title: 'Intervention planifiée',
    startsAt: nextScheduledAt,
    detail: slot,
    href: `/semaine?site=${siteId}`,
  }]
}

function numberOf(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Un blocage sans date de fin est encore en cours. */
function openBlocages<T extends { dateEnd: string | null }>(blocages: T[]): T[] {
  return blocages.filter((b) => b.dateEnd === null)
}

/** Aperçu vide — fallback sûr (forme complète, aucun `undefined`). */
export function emptySiteOverview(siteId = ''): SiteOverview {
  const emptySection: KnowledgeSection = { proposed: [], confirmed: [], summary: { proposed: 0, confirmed: 0 } }
  return {
    identity: { id: siteId, name: '', client: null, status: null },
    activity: { lastVisit: null, picture: null },
    synthesis: {
      status: 'missing',
      version: null,
      updatedAt: null,
      basedOn: null,
      pendingChanges: 0,
      pending: { photos: 0, videos: 0, vocals: 0, notes: 0 },
    },
    actions: { proposed: [], confirmed: [], priority: [], summary: { proposed: 0, active: 0, planned: 0, overdue: 0, completed: 0 } },
    attention: { level: 'calm', reasons: [] },
    nextEvent: null,
    recentChanges: [],
    reserves: { open: 0 },
    blockages: { open: 0 },
    watchpoints: { ...emptySection },
    deadlines: { ...emptySection },
    stakeholders: { ...emptySection },
    knowledge: { ...emptySection },
    history: [],
  }
}

/**
 * Contrat public de la connaissance d'un chantier. Ne throw jamais : chaque source
 * a son repli, et la forme est toujours complète (aucun `undefined`).
 */
export async function getSiteOverview(siteId: string): Promise<SiteOverview> {
  const [proj, actionRows, aSavoir, intervenants, recent, identity, synth, blocages, statusSummary, memorySignals, currentState, activity] = await Promise.all([
    getSiteProjection(siteId).catch(() => emptySiteProjection()),
    readSiteActionSummaries(siteId).catch(() => [] as ActionSummaryRow[]),
    listSiteASavoirActive(siteId).catch(() => []),
    listSiteIntervenants(siteId).catch(() => []),
    getSiteRecentActivity(siteId, HISTORY_LIMIT).catch(() => []),
    getSiteIdentity(siteId).catch(() => null),
    readLatestVisitSynthesis(siteId).catch(() => null),
    listBlocagesBySite(siteId).catch(() => []),
    buildSiteStatusSummary(siteId).catch(() => []),
    buildSiteMemorySignals(siteId).catch(() => []),
    getSiteCurrentState(siteId).catch(() => null),
    getSiteCockpitActivity(siteId, ACTIVITY_LIMIT).catch(() => []),
  ])

  // ── Actions : proposé (projection) + validé (site_actions actives) ──
  const active = actionRows.filter((a) => a.status === 'open' || a.status === 'planned')
  const planned = actionRows.filter((a) => a.status === 'planned').length
  const completed = actionRows.filter((a) => a.status === 'done').length
  const todayIso = new Date().toISOString().slice(0, 10)
  const overdue = active.filter((a) => a.due_date && a.due_date.slice(0, 10) < todayIso).length
  const priority = selectPriorityActions(
    actionRows.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      dueDate: a.due_date,
      createdAt: a.created_at,
      href: `/sites/${siteId}/actions`,
    })),
    { todayIso, limit: 5 },
  ).map<PriorityAction>((a) => ({
    id: a.id,
    title: a.title,
    href: a.href,
    dueLabel: getActionDueLabel({ dueDate: a.dueDate, status: a.status }, todayIso),
    urgency: urgencyOf(a.dueDate, todayIso),
  }))
  const actions: ActionsSection = {
    proposed: proj.actions.proposedTop.slice(0, TOP),
    confirmed: active.slice(0, TOP).map((a) => ({ id: a.id, title: a.title })),
    priority,
    summary: { proposed: proj.actions.proposed, active: active.length, planned, overdue, completed },
  }

  // ── Attention : des RAISONS nommées, pas un voyant ──
  const reasons: AttentionReason[] = buildOverviewAttention([
    ...toBlocageReasons(openBlocages(blocages), siteId),
    ...toMemoryReasons(memorySignals, siteId),
    ...toOverdueActionReasons(active, todayIso, siteId),
  ]).map((r) => ({ id: r.id, kind: r.kind as AttentionKind, title: r.title, detail: r.detail ?? null, href: r.href ?? null }))

  // ── Prochaine étape / changements depuis la dernière venue ──
  const nextEvent = selectNextEvent(
    toEventInputs(currentState?.nextScheduledAt ?? null, currentState?.nextScheduledSlot ?? null, siteId),
    new Date().toISOString(),
  )
  const sinceIso = synth?.endedAt ?? null
  const recentChanges = selectRecentChanges(toChangeInputs(activity), { sinceIso, limit: 5 }).map<OverviewChange>((c) => ({
    id: c.id,
    title: c.title,
    occurredAt: c.occurredAt,
    detail: c.detail ?? null,
    href: c.href ?? null,
  }))

  // ── Connaissances « à savoir » validées (site_notes a_savoir) ──
  const knowledgeConfirmed: KnowledgeItem[] = aSavoir.map((n) => ({ id: n.id, title: n.body }))

  // ── Intervenants validés (casting actif) ──
  const stakeholderConfirmed: KnowledgeItem[] = intervenants.map((it) => ({
    id: it.id,
    title: [it.contactName, it.companyName].filter(Boolean).join(' · ') || it.role,
  }))

  // ── État de synthèse de la dernière visite (SANS jamais regénérer) ──
  // La visite est la vérité ; la synthèse en est une lecture horodatée. On compare
  // ce que la synthèse avait pris en compte à ce que la visite contient MAINTENANT.
  let status: SynthesisStatus = 'missing'
  let pending: SnapshotDelta = { photos: 0, videos: 0, vocals: 0, notes: 0 }
  let pendingChanges = 0
  if (synth) {
    const generating = synth.generatingAt != null && Date.parse(synth.generatingAt) > 0
      && (Date.now() - Date.parse(synth.generatingAt) < GENERATING_LEASE_MS)
    if (synth.hasAnalysis) {
      const current = await readVisitSourceSnapshot(synth.reportId).catch(() => null)
      if (current) {
        pending = computeSnapshotDelta(synth.sourceSnapshot, current)
        pendingChanges = countSnapshotDelta(pending)
      }
    }
    status = generating
      ? 'generating'
      : !synth.hasAnalysis
        ? 'missing'
        : pendingChanges > 0
          ? 'outdated'
          : 'up_to_date'
  }

  return {
    identity: {
      id: siteId,
      name: identity?.name ?? '',
      client: identity?.clientName ?? null,
      status: identity?.phaseLabel ?? null,
    },
    activity: {
      lastVisit: synth ? { reportId: synth.reportId, endedAt: synth.endedAt } : null,
      picture: null,
    },
    synthesis: {
      status,
      version: synth?.version ?? null,
      updatedAt: synth?.updatedAt ?? null,
      basedOn: synth?.corpusHash ?? null,
      pendingChanges,
      pending,
    },
    actions,
    attention: { level: attentionLevelOf(reasons), reasons },
    nextEvent: nextEvent
      ? { id: nextEvent.id, kind: nextEvent.kind, title: nextEvent.title, startsAt: nextEvent.startsAt, detail: nextEvent.detail ?? null, href: nextEvent.href ?? null }
      : null,
    recentChanges,
    reserves: { open: numberOf(statusSummary.find((s) => s.key === 'reserves')?.value) },
    blockages: { open: openBlocages(blocages).length },
    watchpoints: proposedOnly(proj.watchpoints),
    deadlines: proposedOnly(proj.deadlines),
    stakeholders: proposedAndConfirmed(proj.stakeholders, stakeholderConfirmed, stakeholderConfirmed.length),
    knowledge: proposedAndConfirmed(proj.knowledge, knowledgeConfirmed, knowledgeConfirmed.length),
    history: recent.map((a) => ({
      id: a.reportId ?? a.href,
      label: a.label,
      at: a.at,
      kind: a.kind,
      href: a.href,
      detail: a.detail,
    })),
  }
}
