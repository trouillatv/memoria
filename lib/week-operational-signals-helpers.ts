// Types client-safe + helpers PURS pour l'agrégateur de signaux opérationnels.
//
// Extraits du module serveur (lib/db/week-operational-signals.ts) pour ne pas
// faire remonter `admin` (server-only) dans le bundle client via un composant
// qui importerait ces types — même piège que week-planning-helpers.ts.

// Événements datés (posés sur un jour) vs conditions en cours (au site, datées
// par leur ancienneté). Volontairement deux ensembles disjoints de `kind`.
export type WeekDayKind = 'action_due' | 'reserve_open' | 'meeting' | 'delivery'
export type WeekStandingKind = 'blocage' | 'reserve_open'
export type WeekSignalKind = WeekDayKind | WeekStandingKind

export interface WeekOperationalSignal {
  id: string
  kind: WeekSignalKind
  /** Événement daté : le jour (yyyy-mm-dd) dans [weekStart, weekEnd].
   *  Condition en cours : null (pas de jour propre). */
  day: string | null
  label: string
  detail: string | null
  /** Conditions en cours uniquement : date d'origine (yyyy-mm-dd) → ancienneté
   *  « depuis N jours », calculée à l'affichage. null pour les événements datés. */
  since: string | null
}

export interface SiteWeekSignals {
  siteId: string
  siteName: string
  contractId: string | null
  contractName: string | null
  /** Événements ponctuels, 7 jours Lun→Dim ; chaque valeur = tableau (≥0). */
  days: Record<string, WeekOperationalSignal[]>
  /** Conditions en cours sur la semaine (blocage, réserve ouverte) — synthèse site. */
  standing: WeekOperationalSignal[]
  /** Total signaux (datés + en cours) — commodité d'affichage, descriptif. */
  total: number
}

/**
 * Ancienneté en jours pleins entre `since` (yyyy-mm-dd) et `todayIso` (yyyy-mm-dd).
 * Renvoie null si pas de date, date illisible, ou date dans le futur (pas
 * d'« ancienneté négative »). Calcul en UTC pur, sans dépendance au fuseau local.
 */
export function ageInDays(since: string | null, todayIso: string): number | null {
  if (!since) return null
  const a = Date.parse(since + 'T00:00:00Z')
  const b = Date.parse(todayIso + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  const d = Math.floor((b - a) / 86_400_000)
  return d >= 0 ? d : null
}
