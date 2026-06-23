// Récit du chantier — la TROISIÈME lentille sur les mêmes sources.
//
//   - Journal (getSiteJournal)        = brut, jour par jour, toutes interventions.
//   - Mémoire du lieu (TraceStream)   = traces qui CHANGENT le lieu (fading, dedup).
//   - Récit (ici)                     = les JALONS, lus comme une HISTOIRE.
//
// Doctrine : aucune nouvelle table — projection en lecture des objets existants
// (réunions, blocages, livraisons, réserves, décisions, actions terminées).
// 1 source → N surfaces. Descriptif, jamais un score. La synthèse « Raconte-moi
// ce chantier » est 100 % DÉTERMINISTE (compte et regroupe ; aucun LLM). La
// version LLM (« pourquoi le retard ») viendra plus tard, encadrée.

import { createAdminClient } from '@/lib/supabase/admin'
import { listReportsBySite } from '@/lib/db/site-reports'
import { listBlocagesBySite, type SiteBlocage } from '@/lib/db/site-blocages'
import { getSiteDeliveries } from '@/lib/db/site-delivery'
import { getSiteReserves, summarizeReserves, type SiteReserve } from '@/lib/db/site-reserve'
import { listDecisionsBySite } from '@/lib/db/site-decisions'
import { BLOCAGE_TYPE_LABEL, type BlocageType } from '@/lib/db/blocage-constants'

export type NarrativeKind =
  | 'reunion'
  | 'blocage'
  | 'livraison'
  | 'reserve_ouverte'
  | 'reserve_levee'
  | 'decision'
  | 'action_terminee'

export interface NarrativeEvent {
  at: string // ISO (clé de tri)
  date: string // yyyy-mm-dd civil (Pacific/Noumea)
  kind: NarrativeKind
  icon: string
  title: string
  detail: string | null
}

export interface NarrativeMonth {
  monthKey: string // yyyy-mm
  monthLabel: string // « Mars 2026 »
  events: NarrativeEvent[] // chronologique ASC dans le mois
}

export interface BlocageBreakdown {
  type: BlocageType
  label: string
  count: number
  days: number
  pct: number // part des jours cumulés de blocage
}

export interface SiteStorySummary {
  startedOn: string | null // 1er jalon (civil)
  lastOn: string | null
  durationDays: number | null // démarrage → aujourd'hui
  reunions: number
  decisions: number
  topSubject: string | null
  blocages: { total: number; totalDays: number; byType: BlocageBreakdown[] }
  reserves: { open: number; lifted: number }
  phase: string // déterministe
}

export interface SiteNarrative {
  months: NarrativeMonth[]
  summary: SiteStorySummary
}

// ── Présentation par type (emoji = lecture « humaine », ≠ Lucide du TraceStream) ──

export const NARRATIVE_META: Record<NarrativeKind, { icon: string; label: string }> = {
  reunion: { icon: '📝', label: 'Réunion' },
  blocage: { icon: '⛔', label: 'Blocage' },
  livraison: { icon: '🚚', label: 'Livraison' },
  reserve_ouverte: { icon: '📋', label: 'Réserve ouverte' },
  reserve_levee: { icon: '✅', label: 'Réserve levée' },
  decision: { icon: '🧭', label: 'Décision' },
  action_terminee: { icon: '✔️', label: 'Action terminée' },
}

// ── Helpers PURS (testables sans Supabase) ───────────────────────────────────

/** ISO → date civile yyyy-mm-dd (Pacific/Noumea). en-CA rend déjà yyyy-mm-dd. */
function civilDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Pacific/Noumea' })
}

/** Date civile (déjà yyyy-mm-dd) → ISO minuit UTC, stable pour le tri. */
function dateOnlyToIso(d: string): string {
  return `${d}T00:00:00.000Z`
}

export function monthLabelFr(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const label = new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Groupe les événements par mois (ASC), événements ASC dans le mois. PUR. */
export function buildNarrativeMonths(events: NarrativeEvent[]): NarrativeMonth[] {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const byMonth = new Map<string, NarrativeEvent[]>()
  for (const e of sorted) {
    const key = e.date.slice(0, 7)
    const arr = byMonth.get(key) ?? []
    arr.push(e)
    byMonth.set(key, arr)
  }
  return [...byMonth.keys()]
    .sort()
    .map((monthKey) => ({ monthKey, monthLabel: monthLabelFr(monthKey), events: byMonth.get(monthKey)! }))
}

export interface StorySummaryInput {
  events: NarrativeEvent[]
  reunions: number
  decisions: number
  blocages: SiteBlocage[]
  reserves: SiteReserve[]
  topSubject: string | null
  todayCivil: string
}

function daysBetween(fromCivil: string, toCivil: string): number {
  const a = Date.parse(`${fromCivil}T00:00:00Z`)
  const b = Date.parse(`${toCivil}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/** Synthèse déterministe « Raconte-moi ce chantier ». PUR. */
export function buildStorySummary(input: StorySummaryInput): SiteStorySummary {
  const { events, reunions, decisions, blocages, reserves, topSubject, todayCivil } = input
  const dates = events.map((e) => e.date).sort()
  const startedOn = dates[0] ?? null
  const lastOn = dates[dates.length - 1] ?? null

  // Jours cumulés de blocage, par type. Un blocage en cours compte jusqu'à aujourd'hui.
  const dayByType = new Map<BlocageType, number>()
  const countByType = new Map<BlocageType, number>()
  let totalDays = 0
  for (const b of blocages) {
    const end = b.dateEnd ?? todayCivil
    const days = daysBetween(b.dateStart, end) + 1 // inclusif
    dayByType.set(b.type, (dayByType.get(b.type) ?? 0) + days)
    countByType.set(b.type, (countByType.get(b.type) ?? 0) + 1)
    totalDays += days
  }
  const byType: BlocageBreakdown[] = [...dayByType.entries()]
    .map(([type, days]) => ({
      type,
      label: BLOCAGE_TYPE_LABEL[type],
      count: countByType.get(type) ?? 0,
      days,
      pct: totalDays ? Math.round((days / totalDays) * 100) : 0,
    }))
    .sort((a, b) => b.days - a.days)

  const reserveSummary = summarizeReserves(reserves)
  const ongoingBlocage = blocages.some((b) => b.dateEnd === null)

  // Phase déterministe (jamais une prédiction).
  let phase = 'En cours'
  if (reserveSummary.open + reserveSummary.lifted > 0) phase = 'Réception (levée de réserves)'
  else if (ongoingBlocage) phase = 'En cours (blocage actif)'

  return {
    startedOn,
    lastOn,
    durationDays: startedOn ? daysBetween(startedOn, todayCivil) : null,
    reunions,
    decisions,
    topSubject,
    blocages: { total: blocages.length, totalDays, byType },
    reserves: reserveSummary,
    phase,
  }
}

// ── Helper principal ─────────────────────────────────────────────────────────

export async function getSiteNarrative(siteId: string): Promise<SiteNarrative> {
  const sb = createAdminClient()
  const [reports, blocages, deliveries, reserves, decisions, doneActionsRes, subjectsRes] =
    await Promise.all([
      listReportsBySite(siteId),
      listBlocagesBySite(siteId),
      getSiteDeliveries(siteId),
      getSiteReserves(siteId),
      listDecisionsBySite(siteId),
      sb.from('site_actions').select('id, title, done_at, created_at').eq('site_id', siteId).eq('status', 'done'),
      sb.from('subjects').select('id, name').eq('site_id', siteId),
    ])

  const events: NarrativeEvent[] = []

  // Réunions (jalons forts) — listReportsBySite exclut déjà les brouillons.
  for (const r of reports) {
    const iso = r.created_at
    events.push({
      at: iso,
      date: civilDate(iso),
      kind: 'reunion',
      icon: NARRATIVE_META.reunion.icon,
      title: r.title?.trim() || 'Réunion chantier',
      detail: null,
    })
  }

  // Blocages.
  for (const b of blocages) {
    const ongoing = b.dateEnd === null
    const detail = [
      BLOCAGE_TYPE_LABEL[b.type],
      b.impact,
      ongoing ? 'en cours' : b.dateEnd && b.dateEnd !== b.dateStart ? `levé le ${b.dateEnd}` : 'levé',
    ]
      .filter(Boolean)
      .join(' · ')
    events.push({
      at: dateOnlyToIso(b.dateStart),
      date: b.dateStart,
      kind: 'blocage',
      icon: NARRATIVE_META.blocage.icon,
      title: b.title,
      detail: detail || null,
    })
  }

  // Livraisons.
  for (const d of deliveries) {
    const detail = [d.material, d.quantity, d.zone].filter(Boolean).join(' · ') || null
    events.push({
      at: dateOnlyToIso(d.deliveredOn),
      date: d.deliveredOn,
      kind: 'livraison',
      icon: NARRATIVE_META.livraison.icon,
      title: d.supplier ? `Livraison — ${d.supplier}` : 'Livraison',
      detail,
    })
  }

  // Réserves : ouverture + levée = deux jalons.
  for (const r of reserves) {
    const openOn = r.issuedOn ?? civilDate(r.createdAt)
    events.push({
      at: dateOnlyToIso(openOn),
      date: openOn,
      kind: 'reserve_ouverte',
      icon: NARRATIVE_META.reserve_ouverte.icon,
      title: `Réserve : ${r.label}`,
      detail: r.location,
    })
    if (r.status === 'lifted' && r.liftedAt) {
      const lifted = civilDate(r.liftedAt)
      events.push({
        at: r.liftedAt,
        date: lifted,
        kind: 'reserve_levee',
        icon: NARRATIVE_META.reserve_levee.icon,
        title: `Réserve levée : ${r.label}`,
        detail: r.liftNote,
      })
    }
  }

  // Décisions.
  for (const d of decisions) {
    if (!d.dateDecision) continue
    events.push({
      at: dateOnlyToIso(d.dateDecision),
      date: d.dateDecision,
      kind: 'decision',
      icon: NARRATIVE_META.decision.icon,
      title: d.titre,
      detail: d.description,
    })
  }

  // Actions terminées (fait accompli).
  for (const a of (doneActionsRes.data ?? []) as Array<{ title: string; done_at: string | null; created_at: string }>) {
    const iso = a.done_at ?? a.created_at
    events.push({
      at: iso,
      date: civilDate(iso),
      kind: 'action_terminee',
      icon: NARRATIVE_META.action_terminee.icon,
      title: `Action terminée : ${a.title}`,
      detail: null,
    })
  }

  // Sujet le plus actif (déterministe) : compte blocages + décisions par subjectId.
  const subjectName = new Map<string, string>(
    ((subjectsRes.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
  )
  const subjectScore = new Map<string, number>()
  for (const b of blocages) if (b.subjectId) subjectScore.set(b.subjectId, (subjectScore.get(b.subjectId) ?? 0) + 1)
  for (const d of decisions) if (d.subjectId) subjectScore.set(d.subjectId, (subjectScore.get(d.subjectId) ?? 0) + 1)
  let topSubject: string | null = null
  let topScore = 0
  for (const [sid, score] of subjectScore) {
    if (score > topScore && subjectName.has(sid)) {
      topScore = score
      topSubject = subjectName.get(sid)!
    }
  }

  const todayCivil = civilDate(new Date().toISOString())
  const summary = buildStorySummary({
    events,
    reunions: reports.length,
    decisions: decisions.filter((d) => d.dateDecision).length,
    blocages,
    reserves,
    topSubject,
    todayCivil,
  })

  return { months: buildNarrativeMonths(events), summary }
}
