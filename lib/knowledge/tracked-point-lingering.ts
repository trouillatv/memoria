// ── LOT 2 « Aujourd'hui » — Points qui traînent (mandat Vincent) ──
//
// Définition V3 + départage (Vincent, décision Lot 2 D2 — 2026-09-11, GO implémentation
// après mesure READ-ONLY sur RUS). Les V1 (ancienneté seule) et V2 (MIN_PV_WITHOUT_PROGRESS
// isolé) remontaient 87 % puis 63 % du chantier : un indicateur qui flague presque tout ne
// distingue rien. Le signal retenu est transverse et multi-condition :
//   1. état  : open ou reopened ;
//   2. évolution CONNUE (`latestMeaningfulEventAt` non nul) — sinon exclu du bloc principal,
//      un Point sans date n'est pas une preuve qu'il traîne, seulement un trou de profondeur
//      historique (mandat explicite) ;
//   3. ancienneté ≥ LINGERING_THRESHOLD_DAYS depuis cette évolution ;
//   4. négligence réelle : ≥ MIN_RELEVANT_PASSAGES passages documentés du CHANTIER depuis
//      cette évolution sans que ce Point n'en bénéficie ;
//   5. chantier actif récemment : au moins un passage dans les RECENT_ACTIVITY_DAYS derniers
//      jours — un chantier endormi ne fait pas « traîner » ses Points par simple jachère.
// `pvDates` = dates réelles de visite terrain (site_reports.started_at) UNION de PV historique
// importé (documents.effective_date), réunions exclues (lib/db/visits.ts:listSitePvDates).
//
// Départage (population éligible souvent nombreuse et cliniquement à égalité sur RUS — seulement
// 5 dates d'évolution distinctes constatées site-wide) : AUCUN nouveau score composite, seulement
// des signaux déjà gelés ailleurs, dans cet ordre business (Vincent) :
//   1. attention canonique (critical > high > medium > low > aucune)      — canonical-attention.ts
//   2. action confirmée en retard sur le sujet porteur                    — signal `action_overdue`
//   3. reopened avant open
//   4. nombre d'actions ouvertes liées au sujet porteur
//   5. ancienneté sans changement (plus vieux d'abord)
//   6. nombre de passages traversés sans évolution (plus nombreux d'abord)
//   7. libellé alphabétique — départage TECHNIQUE stable uniquement, pas un signal métier :
//      évite qu'un groupe totalement à égalité change d'ordre selon la requête SQL.
// La page Aujourd'hui affiche au maximum LINGERING_DISPLAY_CAP Points après ce tri.

import 'server-only'

import type { PointReadModelEntry } from '@/lib/knowledge/tracked-point-read-model'
import type { CanonicalAttentionItem } from '@/lib/knowledge/canonical-attention'
import { listSitePvDates } from '@/lib/db/visits'
import { createAdminClient } from '@/lib/supabase/admin'

// Chargement (IO) séparé du calcul (pur) ci-dessous — les consommateurs (onglet desktop,
// fiche mobile) n'importent QUE ce module, jamais `lib/db/visits` ou Supabase directement :
// la doctrine « aucune lecture métier directe » (tests/lib/site-overview-tab.doctrine.test.ts)
// s'applique aux composants de page, pas à la couche connaissance qui les enveloppe.
export async function loadSitePvDates(siteId: string): Promise<string[]> {
  return listSitePvDates(siteId)
}

/** Nombre d'actions `site_actions` OUVERTES par sujet canonique porteur — même jointure
 *  `subject_thread_identity` que `deriveCanonicalAttentionItems`, réutilisée ici sans la
 *  reconstruire (ni dupliquer sa lecture des actions en retard/à échéance, hors périmètre). */
export async function loadOpenActionCountBySubject(siteId: string): Promise<Map<string, number>> {
  const admin = createAdminClient()
  const [threadsResult, actionsResult] = await Promise.all([
    admin
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .eq('site_id', siteId),
    admin
      .from('site_actions')
      .select('subject_thread_id')
      .eq('site_id', siteId)
      .eq('status', 'open'),
  ])
  const threadToCs = new Map<string, string>(
    ((threadsResult.data ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
      .map((t) => [t.subject_thread_id, t.canonical_subject_id]),
  )
  const counts = new Map<string, number>()
  for (const a of (actionsResult.data ?? []) as Array<{ subject_thread_id: string | null }>) {
    if (!a.subject_thread_id) continue
    const csId = threadToCs.get(a.subject_thread_id)
    if (!csId) continue
    counts.set(csId, (counts.get(csId) ?? 0) + 1)
  }
  return counts
}

export const LINGERING_THRESHOLD_DAYS = 90
export const MIN_RELEVANT_PASSAGES = 3
export const RECENT_ACTIVITY_DAYS = 60
export const LINGERING_DISPLAY_CAP = 20

export interface LingeringPointEntry {
  id: string
  siteId: string
  label: string
  ownerCanonicalSubjectId: string | null
  derivedState: 'open' | 'reopened'
  /** Toujours connu : les Points sans évolution datée sont exclus en amont. */
  daysSinceLastEvent: number
  passagesSinceEvent: number
}

/** Contexte de départage — signaux déjà gelés ailleurs, jamais recalculés ici. Optionnels pour
 *  ne pas casser un appelant qui n'aurait pas encore branché l'attention canonique. */
export interface LingeringTieBreakContext {
  attentionItems?: readonly CanonicalAttentionItem[]
  openActionCountBySubject?: ReadonlyMap<string, number>
}

const URGENCY_RANK: Record<'critical' | 'high' | 'medium' | 'low' | 'none', number> = {
  critical: 0, high: 1, medium: 2, low: 3, none: 4,
}

function daysSince(iso: string, today: string): number {
  const days = Math.round((new Date(today).getTime() - new Date(iso).getTime()) / 86_400_000)
  return Number.isFinite(days) ? Math.max(0, days) : 0
}

/** Nombre de passages du chantier postérieurs à `afterIso`. */
function countPassagesAfter(pvDates: readonly string[], afterIso: string): number {
  return pvDates.reduce((n, d) => (d > afterIso ? n + 1 : n), 0)
}

function latestPvDate(pvDates: readonly string[]): string | null {
  return pvDates.reduce<string | null>((max, d) => (max === null || d > max ? d : max), null)
}

export function selectLingeringPoints(
  points: readonly PointReadModelEntry[],
  today: string,
  pvDates: readonly string[] = [],
  context: LingeringTieBreakContext = {},
): LingeringPointEntry[] {
  // Chantier actif récemment : condition au niveau du chantier, pas du Point — un chantier
  // endormi n'a pas de Points « qui traînent », il est simplement en jachère.
  const latest = latestPvDate(pvDates)
  const isSiteActiveRecently = latest !== null && daysSince(latest, today) <= RECENT_ACTIVITY_DAYS
  if (!isSiteActiveRecently) return []

  const attentionByCs = new Map(
    (context.attentionItems ?? []).map((it) => [it.canonicalSubjectId, it]),
  )

  type Candidate = LingeringPointEntry & {
    urgencyRank: number
    overdueConfirmed: boolean
    reopenedRank: number
    openActionCount: number
  }

  const candidates: Candidate[] = []
  for (const p of points) {
    if (p.derivedState !== 'open' && p.derivedState !== 'reopened') continue
    if (!p.latestMeaningfulEventAt) continue // évolution inconnue : jamais assimilé à « traîne »
    const daysSinceLastEvent = daysSince(p.latestMeaningfulEventAt, today)
    if (daysSinceLastEvent < LINGERING_THRESHOLD_DAYS) continue
    const passagesSinceEvent = countPassagesAfter(pvDates, p.latestMeaningfulEventAt)
    if (passagesSinceEvent < MIN_RELEVANT_PASSAGES) continue

    const attention = p.ownerCanonicalSubjectId ? attentionByCs.get(p.ownerCanonicalSubjectId) : undefined
    candidates.push({
      id: p.id,
      siteId: p.siteId,
      label: p.label,
      ownerCanonicalSubjectId: p.ownerCanonicalSubjectId,
      derivedState: p.derivedState,
      daysSinceLastEvent,
      passagesSinceEvent,
      urgencyRank: URGENCY_RANK[attention?.urgency ?? 'none'],
      overdueConfirmed: attention?.signals.includes('action_overdue') ?? false,
      reopenedRank: p.derivedState === 'reopened' ? 0 : 1,
      openActionCount: p.ownerCanonicalSubjectId
        ? context.openActionCountBySubject?.get(p.ownerCanonicalSubjectId) ?? 0
        : 0,
    })
  }

  candidates.sort((a, b) => {
    if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank
    if (a.overdueConfirmed !== b.overdueConfirmed) return a.overdueConfirmed ? -1 : 1
    if (a.reopenedRank !== b.reopenedRank) return a.reopenedRank - b.reopenedRank
    if (a.openActionCount !== b.openActionCount) return b.openActionCount - a.openActionCount
    if (a.daysSinceLastEvent !== b.daysSinceLastEvent) return b.daysSinceLastEvent - a.daysSinceLastEvent
    if (a.passagesSinceEvent !== b.passagesSinceEvent) return b.passagesSinceEvent - a.passagesSinceEvent
    return a.label.localeCompare(b.label)
  })

  return candidates.slice(0, LINGERING_DISPLAY_CAP).map((c) => ({
    id: c.id,
    siteId: c.siteId,
    label: c.label,
    ownerCanonicalSubjectId: c.ownerCanonicalSubjectId,
    derivedState: c.derivedState,
    daysSinceLastEvent: c.daysSinceLastEvent,
    passagesSinceEvent: c.passagesSinceEvent,
  }))
}
