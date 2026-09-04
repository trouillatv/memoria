import 'server-only'
import { classifyActionUrgency } from './overdue-action'
import type { ActionUrgency } from './overdue-action'

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
import { buildActivitySinceLastPv, type SiteActivity } from '@/lib/knowledge/site-activity'
import {
  readSiteActionSummaries,
  deduplicateByThread,
  readLatestVisitSynthesis,
  readVisitSourceSnapshot,
  type ActionSummaryRow,
} from '@/lib/knowledge/repository'
import { computeSnapshotDelta, countSnapshotDelta, type SnapshotDelta } from '@/lib/visits/source-snapshot'
import { getSiteIdentity, listSiteASavoirActive } from '@/lib/db/sites'
import { listSiteDeadlines } from '@/lib/db/site-deadlines'
import {
  listWatchpoints, listKnowledgeEntries,
  type Watchpoint, type KnowledgeEntry,
} from '@/lib/db/site-memory-entries'
import { echeanceLine } from '@/lib/visits/echeance-labels'
import { listSiteIntervenants } from '@/lib/db/site-intervenants'
import { listDecisionsBySite, type SiteDecision } from '@/lib/db/site-decisions'
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
import { listScheduledEvents, scheduledTypeLabel, type ScheduledEvent } from '@/lib/db/scheduled-events'
import {
  canonicalRunsForSite,
  runEffectiveDate,
  getSiteSubjectMatrix,
} from '@/lib/documents/pv-history'
import { computeWatchlist, type WatchlistEntry } from '@/lib/documents/pv-watchlist'
import {
  getImportantSubjects,
  type ImportantSubject,
} from '@/lib/documents/site-synthesis'
import { buildOccurrencePvSummary } from '@/lib/documents/occurrence-pv-summary'
import { getSuggestedLinkCountsBySite } from '@/lib/db/subject-thread-links'
import { getActionsPilotageKpi, type PilotageKpi } from '@/lib/knowledge/actions-pilotage'

const TOP = 3
const HISTORY_LIMIT = 5
const ACTIVITY_LIMIT = 12
/** Un verrou de génération plus vieux que ça est considéré comme abandonné (cf. débrief). */
const GENERATING_LEASE_MS = 120_000

export interface KnowledgeItem { id: string; title: string }
export interface HistoryItem { id: string; label: string; at: string; kind: string; href: string; detail: string | null }

// ── Signaux PV canoniques (3 blocs Aperçu) ───────────────────────────────────
/** Un sujet qui demande de l'attention — classé par sévérité décroissante. */
export interface PvAttentionItem {
  canonicalSubjectId: string | null
  label: string
  reason: 'non_conforme' | 'aggravé' | 'réouvert' | 'sans_évolution'
  pvCount: number
  href: string
}

/** Signal compact du dernier delta inter-PV.
 *  P0 convergence : occurrence-first (buildOccurrencePvSummary), même vérité que
 *  Aperçu #230 / Synthèse / Chronologie. reopened ≠ aggravated (catégories séparées),
 *  acteurs exclus via la projection partagée #228, knowledge_fact gardé. */
export interface PvLastDelta {
  fromDate: string
  toDate: string
  nouveaux: number
  réouverts: number
  aggravés: number
  résolus: number
}

/** Un sujet canonique à vérifier, avec les signaux forts qui le qualifient. */
export interface PvVerifyItem {
  canonicalSubjectId: string
  label: string
  signals: string[]
  pendingLinks: number
  href: string
}

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

/** Urgence d'une action — sens métier ; la couleur est l'affaire de l'écran.
 *  'late_unconfirmed' : échéance dépassée mais non confirmée (due_date_status
 *  != 'explicit') — jamais qualifiable de « en retard » (retour Guillaume
 *  2026-08-14, LOT4 — même règle que overdue-action.ts). */
export type { ActionUrgency }
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
  /** Terminées RÉCEMMENT (par date de réalisation, pas de création). Le travail fini
   *  doit se voir : un écran qui ne montre que le reste à faire donne l'impression
   *  qu'on n'avance jamais. */
  completedRecent: KnowledgeItem[]
  priority: PriorityAction[]
  summary: { proposed: number; active: number; planned: number; overdue: number; week: number; undated: number; completed: number }
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
  /** CE QUI LUI ARRIVE — vie du chantier. Séparé de l'identité, qui n'est pas un fourre-tout.
   *  Le chantier doit RESPIRER : on doit sentir qu'une visite vient d'avoir lieu, avec
   *  ce qu'elle a rapporté (ses sources), pas seulement une ligne de base de données. */
  activity: {
    lastVisit: {
      reportId: string
      startedAt: string | null
      endedAt: string | null
      /** Durée de la visite en minutes (null si non calculable). */
      durationMin: number | null
      /** Ce que la visite a rapporté — la matière réelle. */
      sources: SnapshotDelta
      /** Total des sources — « la visite a-t-elle rapporté quelque chose ? ». */
      sourceCount: number
    } | null
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
    /**
     * La connaissance de cette synthèse n'a PAS pu être projetée en propositions.
     * Ce n'est jamais silencieux : sans projection, la visite paraît n'avoir rien
     * produit alors que l'IA avait compris (mig 213).
     */
    projectionFailed: boolean
  }
  actions: ActionsSection
  /** V1-1 — KPI « Actions à piloter » fondé sur la vérité DURABLE (CBO/sujet), pas les 398 formulations
   *  brutes. Raconte les deux niveaux : N sujets, N objets actifs/terminés/à qualifier, N formulations
   *  historiques. `actions` (legacy, site_actions brut) reste pour les consommateurs existants. */
  actionsPilotage: PilotageKpi
  attention: { level: AttentionLevel; reasons: AttentionReason[] }
  nextEvent: OverviewEvent | null
  recentChanges: OverviewChange[]
  reserves: { open: number }
  blockages: { open: number }
  watchpoints: KnowledgeSection
  deadlines: KnowledgeSection
  /** Répartition des échéances CONFIRMÉES — pour afficher « 1 planifiée · 9 à planifier »
   *  sans mélanger avec les propositions encore en attente de validation. */
  deadlineCounts: { planned: number; toPlan: number }
  stakeholders: KnowledgeSection
  /** Les entreprises du casting actif — pour la carte de synthèse de l'Aperçu
   *  (« PAVE · BatiSud · Ginger — Voir tous → »). La liste complète vit dans
   *  l'onglet Intervenants ; l'Aperçu ne porte qu'une synthèse (arbitrage
   *  2026-07-18). */
  stakeholderCompanies: string[]
  knowledge: KnowledgeSection
  /** Ce que le chantier a ACTÉ. L'objet le plus durable du produit était absent
   *  de la vue qui prétend résumer ce qu'il faut savoir : la projection portait
   *  déjà `decisions`, personne ne l'exposait. Elles n'étaient atteignables que
   *  par /recit ou /subjects — la Mémoire mobile, elle, les montrait. */
  decisions: KnowledgeSection
  history: HistoryItem[]
  /** Sujets canoniques qui demandent de l'attention (non-conformes, aggravés, stagnants). */
  pvAttention: PvAttentionItem[]
  /** Signal compact du dernier intervalle inter-PV (null si < 2 PVs). LEGACY — remplacé à l'affichage par pvActivity. */
  pvLastDelta: PvLastDelta | null
  /** #230 — Activité réelle « Depuis le dernier PV » (occurrence-first, catégorisée, cappée). Null si < 2 PV. */
  pvActivity: SiteActivity | null
  /** Sujets canoniques à vérifier en priorité (score + signaux forts + suggestions). */
  pvToVerify: PvVerifyItem[]
}

// `proposedOnly` a été SUPPRIMÉE : elle affichait le proposé sans le validé, pour
// les types dont l'objet métier n'existait pas encore. Il n'en reste aucun — les
// six ont leur table. La garder rouvrirait la porte à l'évaporation : confirmer
// un fait le faisait disparaître de la fiche.

/** Section « proposé + validé ». */
function proposedAndConfirmed(p: ProposalProjection, confirmed: KnowledgeItem[], confirmedTotal: number): KnowledgeSection {
  return {
    proposed: p.proposedTop.slice(0, TOP),
    confirmed: confirmed.slice(0, TOP),
    summary: { proposed: p.proposed, confirmed: confirmedTotal },
  }
}

/** Urgence métier — délègue au classifieur canonique partagé (overdue-action). */
function urgencyOf(dueDate: string | null, dueDateStatus: 'explicit' | 'estimated' | null, todayIso: string): ActionUrgency {
  return classifyActionUrgency(dueDate, dueDateStatus, todayIso)
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

// Une échéance non confirmée (due_date_status != 'explicit') n'est jamais qualifiée
// « en retard » (retour Guillaume 2026-08-14, LOT4 — même règle que canonical-attention.ts
// et site-attention-items.ts, via lib/knowledge/overdue-action.ts).
function toOverdueActionReasons(rows: ActionSummaryRow[], todayIso: string, siteId: string): OverviewSignalInput[] {
  return rows
    .filter((a) => a.due_date && a.due_date.slice(0, 10) < todayIso && a.due_date_status === 'explicit')
    .slice(0, 2)
    .map((a) => ({
      id: `late-${a.id}`,
      kind: 'action_overdue' as const,
      title: a.title,
      detail: getActionDueLabel({ dueDate: a.due_date, status: a.status, dueDateStatus: a.due_date_status }, todayIso),
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

function toEventInputs(
  nextScheduledAt: string | null,
  slot: string | null,
  siteId: string,
  scheduledEvents: ScheduledEvent[],
): OverviewEventInput[] {
  const inputs: OverviewEventInput[] = []

  for (const ev of scheduledEvents) {
    if (ev.type !== 'visit' && ev.type !== 'meeting') continue
    if (ev.status !== 'planned' && ev.status !== 'postponed') continue
    inputs.push({
      id: ev.id,
      kind: ev.type === 'visit' ? 'visit' : 'meeting',
      title: ev.title ?? scheduledTypeLabel(ev.type),
      startsAt: ev.plannedStart,
      detail: null,
      href: ev.type === 'visit'
        ? `/sites/${siteId}/visites/prevue/${ev.id}`
        : `/sites/${siteId}/reunions/prevue/${ev.id}`,
    })
  }

  if (nextScheduledAt) {
    inputs.push({
      id: nextScheduledAt,
      kind: 'intervention',
      title: 'Intervention planifiée',
      startsAt: nextScheduledAt,
      detail: slot,
      href: `/semaine?site=${siteId}`,
    })
  }

  return inputs
}

function numberOf(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Durée d'une visite, en minutes. Null si l'une des bornes manque ou si la
 *  durée dépasse 24h (visite laissée ouverte accidentellement). */
function durationMinutes(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null
  const ms = Date.parse(endedAt) - Date.parse(startedAt)
  if (!Number.isFinite(ms) || ms <= 0) return null
  if (ms > 24 * 60 * 60_000) return null
  return Math.max(1, Math.round(ms / 60_000))
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
      projectionFailed: false,
    },
    actions: { proposed: [], confirmed: [], completedRecent: [], priority: [], summary: { proposed: 0, active: 0, planned: 0, overdue: 0, week: 0, undated: 0, completed: 0 } },
    actionsPilotage: { subjectsWithActions: 0, activeCbo: 0, completedCbo: 0, toQualifyCbo: 0, unattachedCbo: 0, totalCbo: 0, historicalFormulations: 0 },
    attention: { level: 'calm', reasons: [] },
    nextEvent: null,
    recentChanges: [],
    reserves: { open: 0 },
    blockages: { open: 0 },
    watchpoints: { ...emptySection },
    deadlines: { ...emptySection },
    deadlineCounts: { planned: 0, toPlan: 0 },
    stakeholders: { ...emptySection },
    stakeholderCompanies: [],
    knowledge: { ...emptySection },
    decisions: { ...emptySection },
    history: [],
    pvAttention: [],
    pvLastDelta: null,
    pvActivity: null,
    pvToVerify: [],
  }
}

const PV_ATTENTION_MAX = 5
const PV_VERIFY_MAX    = 5

/** Construit les 3 blocs PV en parallèle. Retourne null si le chantier n'a pas de PV analysés. */
async function fetchPvSignalData(siteId: string): Promise<{
  pvAttention: PvAttentionItem[]
  pvLastDelta: PvLastDelta | null
  pvToVerify: PvVerifyItem[]
} | null> {
  const [runs, matrix, importantSubjects, suggestedCounts] = await Promise.all([
    canonicalRunsForSite(siteId).catch(() => []),
    getSiteSubjectMatrix(siteId).catch(() => null),
    getImportantSubjects(siteId).catch(() => [] as ImportantSubject[]),
    getSuggestedLinkCountsBySite(siteId).catch(() => ({} as Record<string, number>)),
  ])

  if (runs.length === 0 && !matrix) return null

  // Map threadId → canonicalSubjectId pour enrichir les WatchlistEntry
  const threadToCs = new Map<string, string | null>()
  if (matrix) {
    for (const row of matrix.rows) {
      if (row.canonicalSubjectId) threadToCs.set(row.subjectThreadId, row.canonicalSubjectId)
    }
  }

  // Bloc 1 — Ce qui demande votre attention
  const watchlist: WatchlistEntry[] = matrix ? computeWatchlist(matrix) : []
  const pvAttention: PvAttentionItem[] = watchlist.slice(0, PV_ATTENTION_MAX).map((w) => {
    const csId = threadToCs.get(w.subjectThreadId) ?? null
    return {
      canonicalSubjectId: csId,
      label: w.label,
      reason: w.reason,
      pvCount: w.pvCount,
      href: csId
        ? `/sites/${siteId}/historique/sujets/${csId}`
        : `/sites/${siteId}/historique?view=lifelines`,
    }
  })

  // Bloc 2 — Depuis le dernier PV
  // P0 convergence : occurrence-first (buildOccurrencePvSummary), catégories séparées
  // réouvert/aggravé, acteurs exclus (projection partagée), knowledge_fact gardé —
  // même vérité que l'Aperçu #230 / Synthèse / Chronologie / Lignes de vie.
  let pvLastDelta: PvLastDelta | null = null
  if (runs.length >= 2) {
    const fromRun = runs[runs.length - 2]
    const toRun   = runs[runs.length - 1]
    const summary = await buildOccurrencePvSummary(siteId, fromRun.id, toRun.id).catch(() => null)
    if (summary) {
      pvLastDelta = {
        fromDate:  runEffectiveDate(fromRun),
        toDate:    runEffectiveDate(toRun),
        nouveaux:  summary.nouveau.length,
        réouverts: summary.réouvert.length,
        aggravés:  summary.aggravé.length,
        résolus:   summary.résolu.length,
      }
    }
  }

  // Bloc 3 — À vérifier
  const pvToVerify: PvVerifyItem[] = importantSubjects
    .slice(0, PV_VERIFY_MAX)
    .map((s) => {
      const signals: string[] = []
      // overdueDeadlines booste le score (×6) mais n'a pas de signal cockpit dédié :
      // on expose activeDeadlines avec un libellé neutre pour ne pas qualifier "en retard"
      // sans confirmation cockpit (voir dette deadline_overdue).
      if (s.activeDeadlines > 0)   signals.push(`${s.activeDeadlines} échéance${s.activeDeadlines > 1 ? 's' : ''} associée${s.activeDeadlines > 1 ? 's' : ''}`)
      if (s.openReserves > 0)      signals.push(`${s.openReserves} réserve${s.openReserves > 1 ? 's' : ''} ouverte${s.openReserves > 1 ? 's' : ''}`)
      if (s.reappearance)          signals.push('réapparu après absence')
      if (signals.length === 0)    signals.push(`${s.pvCount} PV · score ${s.score}`)
      const pendingLinks = suggestedCounts[s.canonicalSubjectId] ?? 0
      return {
        canonicalSubjectId: s.canonicalSubjectId,
        label:              s.label,
        signals,
        pendingLinks,
        href:               `/sites/${siteId}/historique/sujets/${s.canonicalSubjectId}`,
      }
    })

  return { pvAttention, pvLastDelta, pvToVerify }
}

/**
 * Contrat public de la connaissance d'un chantier. Ne throw jamais : chaque source
 * a son repli, et la forme est toujours complète (aucun `undefined`).
 */
export async function getSiteOverview(siteId: string): Promise<SiteOverview> {
  const [proj, actionRows, aSavoir, intervenants, recent, identity, synth, blocages, statusSummary, memorySignals, currentState, activity, deadlineRows, watchpointRows, knowledgeRows, decisionRows, pvSignal, scheduledEvents, pvActivity] = await Promise.all([
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
    // Les échéances VALIDÉES : la fiche doit les montrer, pas seulement le Planning.
    listSiteDeadlines(siteId).catch(() => []),
    // Les vigilances et connaissances VALIDÉES (mig 217 / 218).
    listWatchpoints(siteId).catch(() => [] as Watchpoint[]),
    listKnowledgeEntries(siteId).catch(() => [] as KnowledgeEntry[]),
    // Les décisions ACTÉES — même source que la Mémoire mobile, pour qu'un fait
    // ne soit pas vrai sur un écran et absent de l'autre.
    listDecisionsBySite(siteId).catch(() => [] as SiteDecision[]),
    // Signaux PV canoniques : 3 blocs de l'Aperçu construits sur la structure Histoire.
    fetchPvSignalData(siteId).catch(() => null),
    // Moments prévus (visites, réunions) — convergence 3D.
    listScheduledEvents(siteId, { from: new Date().toISOString() }).catch(() => [] as ScheduledEvent[]),
    // #230 — Activité « Depuis le dernier PV » (occurrence-first).
    buildActivitySinceLastPv(siteId).catch(() => null),
  ])

  // V1-1 — KPI « Actions à piloter » (vérité durable CBO/sujet). Best-effort : repli KPI vide.
  const actionsPilotage: PilotageKpi = await getActionsPilotageKpi(siteId).catch(() => ({ subjectsWithActions: 0, activeCbo: 0, completedCbo: 0, toQualifyCbo: 0, unattachedCbo: 0, totalCbo: 0, historicalFormulations: 0 }))

  // ── Actions : proposé (projection) + validé (site_actions actives) ──
  // Déduplication V1 : même subject_thread_id = une seule entrée opérationnelle.
  // Les 52 lignes OCEF Compostage → 36 sujets distincts.
  const active = actionRows.filter((a) => a.status === 'open' || a.status === 'planned')
  const activeDedup = deduplicateByThread(active)
  const completed = actionRows.filter((a) => a.status === 'done').length
  const planned = activeDedup.filter((a) => a.status === 'planned').length
  const todayIso = new Date().toISOString().slice(0, 10)
  // Invariant : overdue = open uniquement. Une action planned a une prise en charge
  // explicite (intervention planifiée) ; l'inclure dans "en retard" contredit le moteur canonical.
  // Une échéance non confirmée (due_date_status != 'explicit') n'est jamais « en retard »
  // (retour Guillaume 2026-08-14, LOT4 — même règle que canonical-attention.ts).
  const overdue = activeDedup.filter((a) => a.status === 'open' && a.due_date && a.due_date.slice(0, 10) < todayIso && a.due_date_status === 'explicit').length
  const week = activeDedup.filter((a) => {
    if (!a.due_date) return false
    const due = a.due_date.slice(0, 10)
    const days = Math.floor((Date.parse(`${due}T00:00:00.000Z`) - Date.parse(`${todayIso}T00:00:00.000Z`)) / 86_400_000)
    return days >= 0 && days <= 7
  }).length
  const undated = activeDedup.filter((a) => !a.due_date).length
  const priority = selectPriorityActions(
    [...activeDedup, ...actionRows.filter((a) => a.status === 'done')].map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      dueDate: a.due_date,
      dueDateStatus: a.due_date_status,
      createdAt: a.created_at,
      href: `/sites/${siteId}/actions`,
    })),
    { todayIso, limit: 5 },
  ).map<PriorityAction>((a) => ({
    id: a.id,
    title: a.title,
    href: a.href,
    dueLabel: getActionDueLabel({ dueDate: a.dueDate, status: a.status, dueDateStatus: a.dueDateStatus }, todayIso),
    urgency: urgencyOf(a.dueDate, a.dueDateStatus, todayIso),
  }))
  // Terminées récemment : triées par date de RÉALISATION. Une action faite hier
  // passe devant une action créée hier et faite il y a un mois.
  const completedRecent = actionRows
    .filter((a) => a.status === 'done' && a.done_at)
    .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))
    .slice(0, TOP)
    .map((a) => ({ id: a.id, title: a.title }))

  const actions: ActionsSection = {
    proposed: proj.actions.proposedTop.slice(0, TOP),
    confirmed: activeDedup.slice(0, TOP).map((a) => ({ id: a.id, title: a.title })),
    completedRecent,
    priority,
    summary: { proposed: proj.actions.proposed, active: activeDedup.length, planned, overdue, week, undated, completed },
  }

  // ── Attention : des RAISONS nommées, pas un voyant ──
  const reasons: AttentionReason[] = buildOverviewAttention([
    ...toBlocageReasons(openBlocages(blocages), siteId),
    ...toMemoryReasons(memorySignals, siteId),
    ...toOverdueActionReasons(activeDedup.filter((a) => a.status === 'open'), todayIso, siteId),
  ]).map((r) => ({ id: r.id, kind: r.kind as AttentionKind, title: r.title, detail: r.detail ?? null, href: r.href ?? null }))

  // ── Prochaine étape / changements depuis la dernière venue ──
  const nextEvent = selectNextEvent(
    toEventInputs(currentState?.nextScheduledAt ?? null, currentState?.nextScheduledSlot ?? null, siteId, scheduledEvents),
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

  // ── Connaissances validées ──
  // DEUX MAGASINS, et c'est un problème ouvert : `site_notes(kind='a_savoir')`
  // (mig 045, saisie humaine directe) et `site_knowledge_entries` (mig 218,
  // promotion d'une proposition). L'union les réconcilie ICI pour que la fiche
  // ne mente pas — une information validée doit rester visible. Mais deux
  // magasins pour « que sait-on de ce chantier » finiront par diverger : la
  // fusion est un arbitrage produit, pas une décision de read model.
  const knowledgeConfirmed: KnowledgeItem[] = [
    ...knowledgeRows.map((k) => ({ id: k.id, title: k.title })),
    ...aSavoir.map((n) => ({ id: n.id, title: n.body })),
  ]

  // ── Vigilances validées (mig 217) ──
  // Avant, `watchpoints` n'affichait que le PROPOSÉ : on retenait un point de
  // vigilance, il quittait « à confirmer » et n'apparaissait plus nulle part ici
  // — le conducteur voyait son information s'évaporer parce qu'il l'avait
  // validée. C'était vrai tant qu'aucun objet Vigilance n'existait ; la table
  // existe depuis la mig 217. Exactement la même faute que pour les échéances
  // (mig 215), refaite parce que le correctif n'avait pas été répliqué.
  const watchpointConfirmed: KnowledgeItem[] = watchpointRows.map((w) => ({ id: w.id, title: w.title }))

  // ── Décisions actées ──
  const decisionConfirmed: KnowledgeItem[] = decisionRows.map((d) => ({ id: d.id, title: d.titre }))

  // ── Intervenants validés (casting actif) ──
  const stakeholderConfirmed: KnowledgeItem[] = intervenants.map((it) => ({
    id: it.id,
    title: [it.contactName, it.companyName].filter(Boolean).join(' · ') || it.role,
  }))

  // ── Échéances validées (mig 215) ──
  // On dit CE QUI doit arriver et QUAND on le sait : une date si elle a été
  // donnée, sinon la contrainte telle qu'elle a été formulée. Jamais l'une pour
  // l'autre — « sous dix jours » n'est pas une date, et le lui faire dire ici
  // serait inventer ce que personne n'a dit.
  const deadlineConfirmed: KnowledgeItem[] = deadlineRows.map((d) => ({
    id: d.id,
    title: echeanceLine({ label: d.title, date: d.due_date ?? '', constraint: d.constraint_text ?? '' }),
  }))

  // ── État de synthèse de la dernière visite (SANS jamais regénérer) ──
  // La visite est la vérité ; la synthèse en est une lecture horodatée. On compare
  // ce que la synthèse avait pris en compte à ce que la visite contient MAINTENANT.
  let status: SynthesisStatus = 'missing'
  let pending: SnapshotDelta = { photos: 0, videos: 0, vocals: 0, notes: 0 }
  let pendingChanges = 0
  let sources: SnapshotDelta = { photos: 0, videos: 0, vocals: 0, notes: 0 }
  if (synth) {
    const generating = synth.generatingAt != null && Date.parse(synth.generatingAt) > 0
      && (Date.now() - Date.parse(synth.generatingAt) < GENERATING_LEASE_MS)
    // Les sources sont lues même sans analyse : une visite qui a rapporté 4 photos
    // « respire » à l'écran, qu'elle ait été analysée ou non.
    const current = await readVisitSourceSnapshot(synth.reportId).catch(() => null)
    if (current) {
      sources = { photos: current.photos, videos: current.videos, vocals: current.vocals, notes: current.notes }
      if (synth.hasAnalysis) {
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
      lastVisit: synth
        ? {
            reportId: synth.reportId,
            startedAt: synth.startedAt,
            endedAt: synth.endedAt,
            durationMin: durationMinutes(synth.startedAt, synth.endedAt),
            sources,
            sourceCount: countSnapshotDelta(sources),
          }
        : null,
      picture: null,
    },
    synthesis: {
      status,
      version: synth?.version ?? null,
      updatedAt: synth?.updatedAt ?? null,
      basedOn: synth?.corpusHash ?? null,
      pendingChanges,
      pending,
      projectionFailed: synth?.projectionError != null,
    },
    actions,
    actionsPilotage,
    attention: { level: attentionLevelOf(reasons), reasons },
    nextEvent: nextEvent
      ? { id: nextEvent.id, kind: nextEvent.kind, title: nextEvent.title, startsAt: nextEvent.startsAt, detail: nextEvent.detail ?? null, href: nextEvent.href ?? null }
      : null,
    recentChanges,
    reserves: { open: numberOf(statusSummary.find((s) => s.key === 'reserves')?.value) },
    blockages: { open: openBlocages(blocages).length },
    watchpoints: proposedAndConfirmed(proj.watchpoints, watchpointConfirmed, watchpointConfirmed.length),
    // Une échéance CONFIRMÉE doit rester visible sur la fiche. Avant, `deadlines`
    // ne montrait que le proposé : on confirmait, l'échéance quittait « à confirmer »
    // et n'apparaissait plus nulle part ici — le conducteur voyait son information
    // s'évaporer parce qu'il l'avait validée. C'était vrai tant qu'aucun objet
    // Échéance n'existait ; la table existe désormais (mig 215).
    deadlines: proposedAndConfirmed(proj.deadlines, deadlineConfirmed, deadlineConfirmed.length),
    deadlineCounts: {
      planned: deadlineRows.filter((d) => d.status === 'planned').length,
      toPlan:  deadlineRows.filter((d) => d.status === 'to_plan').length,
    },
    stakeholders: proposedAndConfirmed(proj.stakeholders, stakeholderConfirmed, stakeholderConfirmed.length),
    stakeholderCompanies: [...new Set(intervenants.map((it) => it.companyShort || it.companyName).filter(Boolean))],
    knowledge: proposedAndConfirmed(proj.knowledge, knowledgeConfirmed, knowledgeConfirmed.length),
    decisions: proposedAndConfirmed(proj.decisions, decisionConfirmed, decisionConfirmed.length),
    history: recent.map((a) => ({
      id: a.reportId ?? a.href,
      label: a.label,
      at: a.at,
      kind: a.kind,
      href: a.href,
      detail: a.detail,
    })),
    pvAttention:  pvSignal?.pvAttention  ?? [],
    pvLastDelta:  pvSignal?.pvLastDelta  ?? null,
    pvActivity,
    pvToVerify:   pvSignal?.pvToVerify   ?? [],
  }
}
