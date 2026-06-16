'use server'

// « Préparer ma visite » / « Que sait-on ici ? » — briefing structuré d'un site.
//
// V1 (2026-06-16) : PURE AGRÉGATION, ZÉRO LLM. On recompose la mémoire déjà
// captée du LIEU en un panneau « À savoir avant d'y aller », lisible en 30s
// sur mobile avant de partir sur site.
//
// Doctrine (verrous durs) :
//   - Sujet = le SITE/lieu, jamais une personne. Les humains n'apparaissent que
//     comme contexte descriptif (« Équipe Gros Œuvre — 12 passages »), jamais
//     avec un score ni un classement.
//   - Aucun appel LLM ici (la V2 LLM est une étape ultérieure).
//   - Wording descriptif et calme — pas d'alarme rouge, pas de gamification.
//   - On RÉUTILISE les helpers DB existants ; aucune nouvelle requête SQL brute.
//
// Robustesse : chaque bloc tourne en parallèle avec .catch(() => fallback) pour
// qu'une seule source en panne ne casse pas tout le brief.

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { logUsageEvent } from '@/lib/db/usage-events'
import { listOpenSiteActions, listSiteActionsBySite, listSiteActionsByReport } from '@/lib/db/site-actions'
import { getSiteReserves } from '@/lib/db/site-reserve'
import { listSiteASavoirActive } from '@/lib/db/sites'
import {
  getSiteAnomalies,
  getSiteCurrentState,
  getSiteReadings,
  getSiteRecentPhotos,
} from '@/lib/db/site-cockpit'
import { getSiteTeamsKnowledge } from '@/lib/db/site-team-knowledge'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listMissionsBySite } from '@/lib/db/missions'
import { listReportsBySite } from '@/lib/db/site-reports'
import { isSystemMissionName } from '@/lib/db/system-missions'

const IdSchema = z.string().uuid()

// ── Forme sérialisable renvoyée au client ───────────────────────────────────

export interface SiteBriefSituation {
  openActions: number
  openAnomalies: number
  /** Prochain passage planifié (ISO), null si aucun. */
  nextScheduledAt: string | null
  /** Passages exécutés ce mois-ci (repère d'activité, jamais par personne). */
  passagesThisMonth: number
}

export interface SiteBriefAction {
  id: string
  title: string
  dueDate: string | null
  createdAt: string
}

/** « À ne pas oublier » — action ouverte EN RETARD ou qui traîne (agrégation
 *  intelligente, zéro LLM). Sujet = le suivi du lieu, jamais une personne. */
export interface SiteBriefVigilance {
  id: string
  title: string
  ageDays: number
  overdue: boolean
}

export interface SiteBriefDoneAction {
  id: string
  title: string
  doneAt: string | null
}

export interface SiteBriefAnomaly {
  id: string
  description: string
}

export interface SiteBriefASavoir {
  id: string
  body: string
}

export interface SiteBriefRecurring {
  text: string
}

export interface SiteBriefTeam {
  name: string
  /** Nombre de passages (interventions toutes) — descriptif, jamais un score. */
  passages: number
}

export interface SiteBriefMeeting {
  id: string
  title: string | null
  createdAt: string
}

/** Réserve non levée (point à lever) — preuve d'exécution restant due. */
export interface SiteBriefReserve {
  id: string
  label: string
  location: string | null
  ageDays: number
}

/** Décisions / actions issues du dernier compte-rendu — pour la prépa réunion. */
export interface SiteBriefLastReport {
  id: string
  title: string | null
  createdAt: string
  actionTitles: string[]
}

/**
 * V2a — « Ce qui a changé depuis la dernière réunion ». DÉTERMINISTE, ZÉRO LLM :
 * pure comparaison de dates contre la date du dernier compte-rendu. L'IA ne doit
 * pas inventer ici, juste comparer — donc on ne met pas d'IA du tout.
 */
export interface SiteBriefChange {
  sinceDate: string
  /** Clôturé/levé/résolu APRÈS le dernier CR. */
  resolved: string[]
  /** Apparu APRÈS le dernier CR. */
  newItems: string[]
  /** Ouvert AVANT le dernier CR et toujours pendant. */
  stillOpen: string[]
}

export interface SiteBrief {
  siteName: string
  contractName: string | null
  situation: SiteBriefSituation
  vigilance: SiteBriefVigilance[]
  openActions: SiteBriefAction[]
  recentDoneActions: SiteBriefDoneAction[]
  anomaliesOpen: SiteBriefAnomaly[]
  aSavoir: SiteBriefASavoir[]
  recurring: SiteBriefRecurring[]
  teams: SiteBriefTeam[]
  missionNames: string[]
  recentPhotosCount: number
  meetings: SiteBriefMeeting[]
  // Blocs orientés « préparer ma réunion » (utiles aussi avant une visite).
  openReserves: SiteBriefReserve[]
  lastReport: SiteBriefLastReport | null
  // V2a — diff déterministe depuis la dernière réunion (null si aucun CR).
  changeSinceLastReport: SiteBriefChange | null
}

export type SiteBriefResult =
  | { ok: true; brief: SiteBrief }
  | { ok: false; error: string }

// ── Auth (miroir de requireOperator dans actions/actions.ts) ────────────────

async function requireOperator(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager' && user.role !== 'chef_equipe') {
    return { ok: false, error: 'Accès refusé' }
  }
  return { ok: true }
}

/**
 * Trace l'ouverture d'un brief (usage produit, best-effort). Une seule fois par
 * ouverture réelle (le client n'appelle pas sur ré-ouverture cachée).
 */
export async function logBriefOpenAction(siteId: string, mode: 'visit' | 'meeting'): Promise<void> {
  if (!IdSchema.safeParse(siteId).success) return
  const auth = await requireOperator()
  if (!auth.ok) return
  await logUsageEvent({
    event: mode === 'meeting' ? 'prepare_meeting_opened' : 'prepare_visit_opened',
    siteId,
  })
}

/**
 * Agrège la mémoire utile d'un site en un brief « À savoir avant d'y aller ».
 * Pure agrégation de helpers existants — aucun LLM, aucune requête nouvelle.
 */
export async function getSiteBriefAction(siteId: string): Promise<SiteBriefResult> {
  if (!IdSchema.safeParse(siteId).success) return { ok: false, error: 'Site invalide' }
  const auth = await requireOperator()
  if (!auth.ok) return auth

  // Toutes les sources en parallèle ; chacune tolère sa propre panne.
  const [
    identity,
    currentState,
    openActionRows,
    doneActionRows,
    anomalies,
    aSavoir,
    readings,
    teamsKnowledge,
    missions,
    photos,
    meetings,
    reserves,
  ] = await Promise.all([
    getSiteIdentity(siteId).catch(() => null),
    getSiteCurrentState(siteId).catch(() => null),
    listOpenSiteActions({ siteIds: [siteId] }).catch(() => []),
    listSiteActionsBySite(siteId, { status: 'done' }).catch(() => []),
    getSiteAnomalies(siteId).catch(() => []),
    listSiteASavoirActive(siteId).catch(() => []),
    getSiteReadings(siteId).catch(() => ({ readings: [] })),
    getSiteTeamsKnowledge(siteId).catch(() => []),
    listMissionsBySite(siteId).catch(() => []),
    getSiteRecentPhotos(siteId, 12).catch(() => []),
    listReportsBySite(siteId).catch(() => []),
    getSiteReserves(siteId).catch(() => []),
  ])

  const openAnomalies = anomalies.filter((a) => a.status === 'open')

  const situation: SiteBriefSituation = {
    openActions: openActionRows.length,
    openAnomalies: openAnomalies.length,
    nextScheduledAt: currentState?.nextScheduledAt ?? null,
    passagesThisMonth: currentState?.passagesThisMonth ?? 0,
  }

  const briefOpenActions: SiteBriefAction[] = openActionRows.slice(0, 5).map((a) => ({
    id: a.id,
    title: a.title,
    dueDate: a.due_date,
    createdAt: a.created_at,
  }))

  // « À ne pas oublier » — actions ouvertes EN RETARD (échéance passée) ou qui
  // TRAÎNENT (ouvertes depuis ≥ 14 j). Hiérarchise ce qui mérite l'attention.
  const STALE_DAYS = 14
  const now = Date.now()
  const vigilance: SiteBriefVigilance[] = openActionRows
    .map((a) => {
      const ageDays = Math.max(0, Math.floor((now - new Date(a.created_at).getTime()) / 86_400_000))
      const overdue = a.due_date ? new Date(a.due_date).getTime() < now : false
      return { id: a.id, title: a.title, ageDays, overdue }
    })
    .filter((v) => v.overdue || v.ageDays >= STALE_DAYS)
    .sort((x, y) => Number(y.overdue) - Number(x.overdue) || y.ageDays - x.ageDays)
    .slice(0, 5)

  // Actions récemment clôturées : tri par done_at desc, top 3.
  const recentDoneActions: SiteBriefDoneAction[] = doneActionRows
    .filter((a) => a.done_at)
    .sort((x, y) => (x.done_at! < y.done_at! ? 1 : -1))
    .slice(0, 3)
    .map((a) => ({ id: a.id, title: a.title, doneAt: a.done_at }))

  const anomaliesOpen: SiteBriefAnomaly[] = openAnomalies
    .slice(0, 5)
    .map((a) => ({ id: a.id, description: a.description }))

  const briefASavoir: SiteBriefASavoir[] = aSavoir
    .slice(0, 6)
    .map((n) => ({ id: n.id, body: n.body }))

  // Résonances / motifs récurrents : on expose le texte factuel des lectures
  // du lieu (déjà ponctué, zéro LLM). Sujet = le lieu.
  const recurring: SiteBriefRecurring[] = (readings.readings ?? [])
    .slice(0, 4)
    .map((r) => ({ text: r.text }))

  // Équipes qui connaissent le site — descriptif, jamais classé/scoré. On garde
  // l'ordre du helper (actives d'abord, dernier passage desc) et on borne.
  const teams: SiteBriefTeam[] = teamsKnowledge
    .slice(0, 6)
    .map((t) => ({ name: t.team_name, passages: t.interventionsTotalCount }))

  // Missions actives (hors missions système), bornées.
  const missionNames = missions
    .filter((m) => m.active !== false && !isSystemMissionName(m.name))
    .slice(0, 8)
    .map((m) => m.name)

  // Réunions / comptes-rendus récents touchant ce site (plus récent d'abord).
  const sortedMeetings = [...meetings].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const briefMeetings: SiteBriefMeeting[] = sortedMeetings
    .slice(0, 4)
    .map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at }))

  // Réserves non levées (points à lever restant dus).
  const openReserves: SiteBriefReserve[] = reserves
    .filter((r) => r.status === 'open')
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      label: r.label,
      location: r.location,
      ageDays: Math.max(0, Math.floor((now - new Date(r.issuedOn ?? r.createdAt).getTime()) / 86_400_000)),
    }))

  // Décisions / actions issues du DERNIER compte-rendu (prépa réunion).
  let lastReport: SiteBriefLastReport | null = null
  const latest = sortedMeetings[0]
  if (latest) {
    const reportActions = await listSiteActionsByReport(latest.id).catch(() => [])
    lastReport = {
      id: latest.id,
      title: latest.title,
      createdAt: latest.created_at,
      actionTitles: reportActions.slice(0, 5).map((a) => a.title),
    }
  }

  // V2a — « Ce qui a changé depuis la dernière réunion » : comparaison de dates
  // contre la date du dernier CR. Zéro LLM (l'IA ne compare pas mieux qu'une
  // date). On exclut les actions ISSUES du dernier CR (montrées à part).
  let changeSinceLastReport: SiteBriefChange | null = null
  if (lastReport) {
    const since = new Date(lastReport.createdAt).getTime()
    const reportId = lastReport.id
    const after = (iso: string | null) => !!iso && new Date(iso).getTime() > since
    const beforeOrAt = (iso: string | null) => !!iso && new Date(iso).getTime() <= since

    // Résolu : clôturé/levé/résolu APRÈS le CR — Y COMPRIS les actions décidées
    // à ce CR et déjà faites (« ce qu'on a décidé est fait »).
    const resolved = [
      ...doneActionRows.filter((a) => after(a.done_at)).map((a) => a.title),
      ...reserves.filter((r) => r.status === 'lifted' && after(r.liftedAt)).map((r) => r.label),
      ...anomalies.filter((a) => a.status === 'resolved' && after(a.resolvedAt)).map((a) => a.description),
    ]
    // Nouveaux : apparu APRÈS le CR et PAS issu de ce CR (son agenda n'est pas « nouveau »).
    const newItems = [
      ...openActionRows.filter((a) => a.report_id !== reportId && after(a.created_at)).map((a) => a.title),
      ...reserves.filter((r) => r.status === 'open' && after(r.createdAt)).map((r) => r.label),
      ...anomalies.filter((a) => a.status === 'open' && after(a.createdAt)).map((a) => a.description),
    ]
    // Toujours ouvert : actions DÉCIDÉES au CR encore ouvertes + items pré-existants encore ouverts.
    const stillOpen = [
      ...openActionRows.filter((a) => a.report_id === reportId || beforeOrAt(a.created_at)).map((a) => a.title),
      ...reserves.filter((r) => r.status === 'open' && beforeOrAt(r.createdAt)).map((r) => r.label),
      ...anomalies.filter((a) => a.status === 'open' && beforeOrAt(a.createdAt)).map((a) => a.description),
    ]
    if (resolved.length || newItems.length || stillOpen.length || lastReport.actionTitles.length) {
      changeSinceLastReport = {
        sinceDate: lastReport.createdAt,
        resolved: resolved.slice(0, 6),
        newItems: newItems.slice(0, 6),
        stillOpen: stillOpen.slice(0, 6),
      }
    }
  }

  return {
    ok: true,
    brief: {
      siteName: identity?.name ?? 'Site',
      contractName: identity?.contractName ?? null,
      situation,
      vigilance,
      openActions: briefOpenActions,
      recentDoneActions,
      anomaliesOpen,
      aSavoir: briefASavoir,
      recurring,
      teams,
      missionNames,
      recentPhotosCount: photos.length,
      meetings: briefMeetings,
      openReserves,
      lastReport,
      changeSinceLastReport,
    },
  }
}
