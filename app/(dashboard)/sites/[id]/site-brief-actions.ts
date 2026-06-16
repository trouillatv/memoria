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
import { listOpenSiteActions, listSiteActionsBySite } from '@/lib/db/site-actions'
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

export interface SiteBrief {
  siteName: string
  contractName: string | null
  situation: SiteBriefSituation
  openActions: SiteBriefAction[]
  recentDoneActions: SiteBriefDoneAction[]
  anomaliesOpen: SiteBriefAnomaly[]
  aSavoir: SiteBriefASavoir[]
  recurring: SiteBriefRecurring[]
  teams: SiteBriefTeam[]
  missionNames: string[]
  recentPhotosCount: number
  meetings: SiteBriefMeeting[]
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

  // Réunions / comptes-rendus récents touchant ce site.
  const briefMeetings: SiteBriefMeeting[] = meetings
    .slice(0, 4)
    .map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at }))

  return {
    ok: true,
    brief: {
      siteName: identity?.name ?? 'Site',
      contractName: identity?.contractName ?? null,
      situation,
      openActions: briefOpenActions,
      recentDoneActions,
      anomaliesOpen,
      aSavoir: briefASavoir,
      recurring,
      teams,
      missionNames,
      recentPhotosCount: photos.length,
      meetings: briefMeetings,
    },
  }
}
