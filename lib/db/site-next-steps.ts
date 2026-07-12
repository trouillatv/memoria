// « PROCHAINE ÉTAPE » (décision 2026-07-12) — le chantier dit toujours ce qui
// vient ensuite. Déterministe, zéro IA : on agrège les trois futurs déjà en
// base — réunions programmées (site_reports.next_meeting_at, mig 131),
// interventions planifiées, échéances d'actions — et on raconte le plus proche.
// La frise répond à « que s'est-il passé ? » ; ce bloc répond à la question
// qu'un conducteur se pose vraiment : « qu'est-ce que je dois faire ensuite ? »

import { createAdminClient } from '@/lib/supabase/admin'

export type NextStepKind = 'reunion' | 'intervention' | 'echeance'

export interface NextStep {
  kind: NextStepKind
  /** Instant ISO de l'étape (échéance d'action : date à minuit Nouméa). */
  at: string
  /** « Réunion de chantier », nom de la mission, titre de l'action. */
  label: string
  /** « mardi 15 juillet » — calculé serveur (fuseau Nouméa). */
  dateLabel: string
  /** « mardi 15 » — l'en-tête de jour de l'agenda « À venir ». */
  dayLabel: string
  /** « 2026-07-15 » (jour Nouméa) — clé de regroupement de l'agenda. */
  dayKey: string
  /** « 09h00 » — null quand l'étape n'a pas d'heure (échéance à la journée). */
  timeLabel: string | null
  /** « aujourd'hui » / « demain » / « dans 12 j » — le compte à rebours du récit. */
  inLabel: string
  href: string
}

const TZ = 'Pacific/Noumea'
// « YYYY-MM-DD » en fuseau Nouméa — le jour VÉCU par le conducteur, pas le jour
// UTC du serveur. Comparable lexicographiquement.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
function dayOf(ms: number): string {
  return dayFmt.format(ms)
}

function dateLabelOf(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date(iso))
}
function dayLabelOf(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', timeZone: TZ }).format(new Date(iso))
}
function timeLabelOf(iso: string): string | null {
  const t = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(iso))
  // Minuit pile (Nouméa) = « pas d'heure » (échéances à la journée).
  return t === '00:00' ? null : t.replace(':', 'h')
}
/** « aujourd'hui » / « demain » / « dans N j » — en JOURS CALENDAIRES Nouméa,
 *  jamais en blocs de 24 h : demain 9h vu ce soir reste « demain ». PUR. */
export function inLabelOf(iso: string, now: number): string {
  const days = Math.round((Date.parse(dayOf(new Date(iso).getTime())) - Date.parse(dayOf(now))) / 86_400_000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'demain'
  return `dans ${days} j`
}

/** Trie les candidats, garde le futur PROCHE, borne à `max` — PUR (CI).
 *  « Futur » = jour calendaire Nouméa ≥ aujourd'hui : une échéance due
 *  aujourd'hui reste visible toute la journée même si minuit est passé
 *  (les étapes horodatées — réunions, interventions — arrivent déjà
 *  filtrées `>= now` par le SQL). Horizon borné (14 j par défaut) : au-delà,
 *  c'est le rôle du Journal — l'agenda du chantier n'est pas un planning. */
export function pickNextSteps(
  candidates: Array<Pick<NextStep, 'kind' | 'at' | 'label' | 'href'>>,
  now: number,
  max = 5,
  horizonDays = 14,
): Array<Pick<NextStep, 'kind' | 'at' | 'label' | 'href'>> {
  const today = dayOf(now)
  const lastDay = dayOf(now + horizonDays * 86_400_000)
  return candidates
    .filter((c) => {
      if (Number.isNaN(new Date(c.at).getTime())) return false
      const day = dayOf(new Date(c.at).getTime())
      return day >= today && day <= lastDay
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, max)
}

export async function getSiteNextSteps(siteId: string, max = 5): Promise<NextStep[]> {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  // Préfiltre SQL à l'horizon de l'agenda (le filtre PUR, en jours Nouméa,
  // reste l'autorité) — +1 j de marge pour le décalage UTC / Nouméa.
  const horizonIso = new Date(Date.now() + 15 * 86_400_000).toISOString()
  const horizonDay = horizonIso.slice(0, 10)

  // Jour civil Nouméa courant — les colonnes DATE (réunions, échéances) se
  // comparent en jours, jamais en instants (le jour UTC peut être la veille).
  const todayNoumea = dayOf(Date.now())

  const [meetings, missionsRes, actionsRes] = await Promise.all([
    // next_meeting_at est une DATE (mig 131) : jour civil, sans heure.
    supabase
      .from('site_reports')
      .select('next_meeting_at')
      .eq('site_id', siteId)
      .not('next_meeting_at', 'is', null)
      .gte('next_meeting_at', todayNoumea)
      .lte('next_meeting_at', horizonDay)
      .order('next_meeting_at', { ascending: true })
      .limit(max),
    supabase.from('missions').select('id, name').eq('site_id', siteId).is('deleted_at', null),
    supabase
      .from('site_actions')
      .select('id, title, due_date')
      .eq('site_id', siteId)
      .in('status', ['open', 'planned'])
      .not('due_date', 'is', null)
      .gte('due_date', todayNoumea)
      .lte('due_date', horizonDay)
      .order('due_date', { ascending: true })
      .limit(max),
  ])

  const candidates: Array<Pick<NextStep, 'kind' | 'at' | 'label' | 'href'>> = []

  for (const m of (meetings.data ?? []) as Array<{ next_meeting_at: string }>) {
    // Date pure → minuit NOUMÉA explicite (comme les échéances) : bon jour
    // affiché, pas d'heure fantôme (« 11h00 » = minuit UTC vu de Nouméa).
    candidates.push({ kind: 'reunion', at: `${m.next_meeting_at}T00:00:00+11:00`, label: 'Réunion de chantier', href: `/m/site/${siteId}/reunions` })
  }

  const missionNameById = new Map(
    ((missionsRes.data ?? []) as Array<{ id: string; name: string }>).map((m) => [m.id, m.name]),
  )
  const missionIds = [...missionNameById.keys()]
  if (missionIds.length > 0) {
    const { data: intv } = await supabase
      .from('interventions')
      .select('id, mission_id, planned_start, status')
      .in('mission_id', missionIds)
      .not('planned_start', 'is', null)
      .gte('planned_start', nowIso)
      .lte('planned_start', horizonIso)
      .neq('status', 'cancelled')
      .order('planned_start', { ascending: true })
      .limit(max)
    for (const i of (intv ?? []) as Array<{ id: string; mission_id: string; planned_start: string }>) {
      candidates.push({
        kind: 'intervention',
        at: i.planned_start,
        label: missionNameById.get(i.mission_id) ?? 'Intervention',
        href: `/m/intervention/${i.id}`,
      })
    }
  }

  for (const a of (actionsRes.data ?? []) as Array<{ title: string; due_date: string }>) {
    // Minuit NOUMÉA explicite (+11, pas de DST) : sans fuseau, le serveur UTC
    // décalerait l'échéance de 11 h (faux « 11h00 », faux compte de jours).
    candidates.push({ kind: 'echeance', at: `${a.due_date}T00:00:00+11:00`, label: a.title, href: `/m/actions?site=${siteId}` })
  }

  const now = Date.now()
  return pickNextSteps(candidates, now, max).map((c) => ({
    ...c,
    dateLabel: dateLabelOf(c.at),
    dayLabel: dayLabelOf(c.at),
    dayKey: dayOf(new Date(c.at).getTime()),
    timeLabel: timeLabelOf(c.at),
    inLabel: inLabelOf(c.at, now),
  }))
}
