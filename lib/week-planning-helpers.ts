// Helpers PURS (client-safe) de la vue semaine — types + calculs ISO 8601 +
// parsing/formatting du paramètre `?week=YYYY-Www`.
//
// Pourquoi un fichier séparé : ces helpers sont importés par des Client
// Components (cf. `app/(dashboard)/semaine/WeekNavigation.tsx`). Ils ne doivent
// donc JAMAIS dépendre, directement ou transitivement, de modules server-only
// (admin Supabase, `'server-only'`). Les fonctions DB asynchrones restent dans
// `lib/db/week-planning.ts` qui réutilise ces helpers internes.
//
// Doctrine V2 (planning) conservée — pas de slot horaire précis dans l'UX,
// `slot` nommé, `member_count` descriptif jamais KPI.

export interface WeekRange {
  /** Lundi yyyy-mm-dd UTC. */
  weekStart: string
  /** Dimanche yyyy-mm-dd UTC. */
  weekEnd: string
  /** Numéro de semaine ISO 8601 (1-53). */
  weekNumber: number
  /** Année ISO 8601 (année du jeudi de la semaine). */
  year: number
}

export interface WeekInterventionCell {
  id: string
  /** Le rythme dont cette occurrence est issue. NULL = saisie à la main.
   *  C'est lui qui permet de dire « ceci est une EXCEPTION au roulement ». */
  template_id: string | null
  mission_id: string
  mission_name: string
  site_id: string
  site_name: string
  /** Nom du client du site — désambiguïsation (« Discount — Pointière »). */
  client_name?: string | null
  contract_id: string
  contract_name: string
  scheduled_for: string
  slot: string | null
  status: string
  skipped_at: string | null
  assigned_team_id: string | null
  assigned_team_name: string | null
  assigned_team_color: string | null
  // V6.1 — heure précise (ancrage prestation, jamais pointage personne).
  planned_start: string | null
  planned_end: string | null
}

export interface SiteRow {
  site_id: string
  site_name: string
  /** Nom du client — affiché dans l'en-tête de ligne (jamais dans les cellules). */
  client_name?: string | null
  contract_id: string
  contract_name: string
  /** Map yyyy-mm-dd → interventions du jour. */
  days: Record<string, WeekInterventionCell[]>
}

export interface TeamRow {
  /** null = "Non-affecté" (toujours rangée en dernier). */
  team_id: string | null
  team_name: string
  team_color: string | null
  /** Effectif courant — info descriptive, jamais KPI. */
  member_count: number
  days: Record<string, WeekInterventionCell[]>
}

/**
 * Calcule la semaine ISO 8601 contenant la date de référence.
 * Lundi=1 → Dimanche=7. `weekNumber` selon ISO 8601 (semaine 1 = 1er jeudi de
 * l'année). `year` = année ISO du jeudi (peut différer de l'année civile en
 * bord d'année). Travaille en UTC pour éviter les drifts de timezone.
 */
export function getWeekRange(ref: Date | string): WeekRange {
  const d = typeof ref === 'string' ? new Date(ref + 'T00:00:00Z') : new Date(ref)
  d.setUTCHours(0, 0, 0, 0)
  const day = d.getUTCDay() // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + diff)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const target = new Date(monday)
  target.setUTCDate(target.getUTCDate() + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const weekNumber =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        (firstThursday.getUTCDay() || 7)) /
        7
    )
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
    weekNumber,
    year: target.getUTCFullYear(),
  }
}

const WEEK_PARAM_RE = /^(\d{4})-W(\d{1,2})$/

/**
 * Parse un paramètre `?week=YYYY-Www` (ISO 8601) en `WeekRange`.
 * `undefined`/chaîne vide/format invalide → semaine courante (fail-safe).
 */
export function parseWeekParam(raw: string | undefined | null): WeekRange {
  if (!raw) return getWeekRange(new Date())
  const m = WEEK_PARAM_RE.exec(raw.trim())
  if (!m) return getWeekRange(new Date())
  const year = Number(m[1])
  const week = Number(m[2])
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) {
    return getWeekRange(new Date())
  }
  const jan4 = new Date(Date.UTC(year, 0, 4))
  jan4.setUTCDate(jan4.getUTCDate() + (week - 1) * 7)
  return getWeekRange(jan4)
}

/** Inverse de `parseWeekParam` : produit la chaîne canonique `YYYY-Www`. */
export function formatWeekParam(range: WeekRange): string {
  return `${range.year}-W${String(range.weekNumber).padStart(2, '0')}`
}
