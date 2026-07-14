// LA VUE MOIS — « est-ce que mon mois est bon ? »
//
// L'écran principal du domaine Planning. Trois garde-fous, posés par Vincent et
// NON NÉGOCIABLES :
//
//   1. PROJECTION UNIQUEMENT. Cette vue ne possède rien, n'édite rien. Elle
//      montre le résultat des roulements, du calendrier, des exceptions et des
//      interventions — puis renvoie à l'écran canonique.
//
//   2. LECTURE EN UN COUP D'ŒIL. Une cellule doit se comprendre en MOINS D'UNE
//      SECONDE. Les états (ok, conflit, fermé, vide, exception) priment sur les
//      détails. Si une cellule demande de lire plusieurs informations,
//      l'information appartient à l'écran de détail — pas ici. C'est la règle
//      anti-Excel : pas d'équipes, pas d'heures, pas de durées, pas de
//      commentaires dans la grille. Jamais.
//
//   3. NAVIGATION CONTEXTUELLE. Chaque clic ouvre l'écran canonique LE PLUS
//      PERTINENT : un conflit ouvre le tiroir du conflit, une exception ouvre
//      l'exception, un jour fermé ouvre le Calendrier, un jour normal ouvre la
//      semaine. Aucune logique métier nouvelle.
//
// Pur : aucune base, aucun réseau. La page assemble les faits ; ce module dit
// ce qu'ils SIGNIFIENT.

/** Ce qu'on sait d'un (chantier, jour) — des FAITS, assemblés par la page. */
export interface DayFacts {
  /** Encore attendues ce jour — HORS décisions « maintenir » déjà tranchées :
   *  re-crier un conflit déjà tranché apprend à ignorer le rouge. */
  expected: number
  /** Déjà faites ou en cours — le passé du mois se lit aussi. */
  done: number
  /** Maintenues malgré une fermeture (décision prise) : du travail prévu, qui
   *  ne doit PLUS alarmer. */
  kept: number
  /** Personnes projetées par les roulements (au-delà de l'horizon de génération). */
  projected: number
  /** Le chantier est déclaré fermé ce jour-là. */
  closed: boolean
  /** Au moins une occurrence dévie de son roulement ce jour-là. */
  hasException: boolean
  /** Le chantier a un roulement publié qui COUVRE ce jour — c'est lui qui rend
   *  un jour vide anormal. Sans roulement, un jour vide est juste un jour vide. */
  cycleCovers: boolean
}

/**
 * L'ÉTAT d'une cellule — un seul, dans un ordre de préséance strict.
 *
 *   conflict  →  fermé ET du monde prévu : une décision attend (rouge)
 *   closed    →  fermé, rien de prévu : information, pas alarme (bleu)
 *   hole      →  OUVERT, couvert par un roulement, et PERSONNE (rouge pâle)
 *   ok        →  du monde est prévu (✓)
 *   projected →  du monde est projeté, pas encore généré (✓ atténué)
 *   empty     →  rien, et rien d'anormal (gris)
 */
export type DayState = 'conflict' | 'closed' | 'hole' | 'ok' | 'projected' | 'empty'

export function dayState(f: DayFacts): DayState {
  // Le conflit ne compte QUE ce qui n'a pas été tranché : une décision
  // « maintenir » est prise — la re-crier tous les mois userait le rouge.
  if (f.closed && (f.expected > 0 || f.projected > 0)) return 'conflict'
  if (f.closed) return 'closed'
  if (f.expected > 0 || f.done > 0 || f.kept > 0) return 'ok'
  if (f.projected > 0) return 'projected'
  // Un jour vide n'est un TROU que si un roulement était censé le couvrir.
  // Sans roulement, crier « 0 » sur chaque case apprendrait à ignorer le rouge.
  if (f.cycleCovers) return 'hole'
  return 'empty'
}

/**
 * OÙ LE CLIC MÈNE — l'écran canonique le plus pertinent, jamais un nouveau.
 *
 * Conflit et exception vivent dans le TIROIR de la semaine (les gestes y sont
 * déjà) ; un jour fermé s'explique dans le Calendrier ; un jour normal s'ouvre
 * dans la semaine.
 */
export type DayTarget = 'week_drawer' | 'calendar' | 'week'

export function dayTarget(state: DayState, hasException: boolean): DayTarget {
  if (state === 'conflict' || hasException) return 'week_drawer'
  if (state === 'closed') return 'calendar'
  return 'week'
}

// ── LE VERDICT — la réponse avant la grille ─────────────────────────────────

export interface MonthVerdict {
  /** Jours du mois sans conflit ni trou, sur le total. */
  readyDays: number
  totalDays: number
  /** « Le mois est prêt à 90 % ». */
  readyPct: number
  conflicts: number
  holes: number
  closedDays: number
  exceptions: number
}

/**
 * Un JOUR est prêt quand aucun chantier n'y porte de conflit ni de trou.
 * Les fermetures et exceptions n'empêchent pas un jour d'être prêt : elles sont
 * de l'information, pas des problèmes — c'est le cœur de la doctrine
 * « le calendrier avant le conflit ».
 */
export function monthVerdict(
  /** grid[dateIso] = les faits de chaque chantier ce jour-là. */
  byDay: Record<string, DayFacts[]>,
): MonthVerdict {
  let readyDays = 0
  let conflicts = 0
  let holes = 0
  let closedDays = 0
  let exceptions = 0

  const days = Object.keys(byDay)
  for (const day of days) {
    let dayOk = true
    for (const f of byDay[day]) {
      const s = dayState(f)
      if (s === 'conflict') {
        conflicts += 1
        dayOk = false
      }
      if (s === 'hole') {
        holes += 1
        dayOk = false
      }
      if (s === 'closed') closedDays += 1
      if (f.hasException) exceptions += 1
    }
    if (dayOk) readyDays += 1
  }

  const totalDays = days.length
  return {
    readyDays,
    totalDays,
    readyPct: totalDays === 0 ? 100 : Math.round((readyDays / totalDays) * 100),
    conflicts,
    holes,
    closedDays,
    exceptions,
  }
}

/** « Le mois est prêt » / « quasiment prêt » / « demande votre attention » —
 *  la phrase que le directeur lit en deux secondes. */
export function verdictPhrase(v: MonthVerdict): string {
  if (v.readyPct === 100) return 'Le mois est prêt.'
  if (v.readyPct >= 90) return 'Le mois est quasiment prêt.'
  return 'Le mois demande votre attention.'
}

// ── Les jours du mois ────────────────────────────────────────────────────────

export interface MonthDay {
  /** yyyy-mm-dd */
  date: string
  /** 1 = lundi … 7 = dimanche */
  weekday: number
  weekend: boolean
  /** Numéro du jour — « 14 ». */
  num: number
}

export function monthDays(monthIso: string): MonthDay[] {
  const [y, m] = monthIso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out: MonthDay[] = []
  for (let d = 1; d <= last; d += 1) {
    const date = `${monthIso}-${String(d).padStart(2, '0')}`
    const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay()
    const weekday = dow === 0 ? 7 : dow
    out.push({ date, weekday, weekend: weekday >= 6, num: d })
  }
  return out
}

// ── COMBIEN DE MONDE — le chiffre de la maquette ────────────────────────────

/** Les personnes prévues ce jour-là sur ce chantier. Le projeté ne s'AJOUTE pas
 *  au réel : il le remplace quand rien n'est encore généré — sinon la même
 *  occurrence serait comptée deux fois. */
export function peopleOn(f: DayFacts): number {
  const real = f.expected + f.done + f.kept
  return real > 0 ? real : f.projected
}

/** Le total d'une ligne — « ce chantier mobilise N passages ce mois-ci ». */
export function rowTotal(days: Record<string, DayFacts>): number {
  return Object.values(days).reduce((sum, f) => sum + peopleOn(f), 0)
}

/** La ligne « Présents » : combien de monde, tous chantiers confondus, chaque
 *  jour. C'est elle qui montre les trous de couverture d'un coup d'œil. */
export function presenceByDay(byDay: Record<string, DayFacts[]>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [day, facts] of Object.entries(byDay)) {
    out[day] = facts.reduce((sum, f) => sum + peopleOn(f), 0)
  }
  return out
}

// ── LE MODE ÉQUIPE — la MÊME projection, regroupée autrement ────────────────
//
// Le garde-fou anti-Excel (§2) tient : Équipe × Jour est SECONDAIRE, comme dans
// la Semaine (`?view=team`), et il montre la COUVERTURE — qui tourne, quel jour.
// La ligne est une ÉQUIPE, jamais une personne nommée : une grille de jours
// travaillés par individu serait une feuille de présence, pas un planning.
// Aucun horaire, aucun commentaire dans la grille.

/** Ce qu'on sait d'une (équipe, jour). Mêmes faits, autre axe. */
export interface TeamDayFacts {
  /** Occurrences réelles de l'équipe ce jour (attendues, faites, maintenues). */
  worked: number
  /** Projetées par un roulement, pas encore générées. */
  projected: number
  /** Occurrences tombant sur un chantier FERMÉ ce jour-là : une décision attend. */
  conflicts: number
  /** Au moins une occurrence dévie de son roulement. */
  hasException: boolean
}

/** conflict → work → projected → rest (repos). */
export type TeamDayState = 'conflict' | 'work' | 'projected' | 'rest'

export function teamDayState(f: TeamDayFacts): TeamDayState {
  if (f.conflicts > 0) return 'conflict'
  if (f.worked > 0) return 'work'
  if (f.projected > 0) return 'projected'
  return 'rest'
}

/** Les jours travaillés d'une équipe sur le mois — le total de la maquette. */
export function teamWorkedDays(days: Record<string, TeamDayFacts>): number {
  return Object.values(days).filter((f) => teamDayState(f) !== 'rest').length
}

/** La ligne « Présents » du mode Équipe : combien d'équipes tournent ce jour. */
export function teamPresenceByDay(
  byDay: Record<string, TeamDayFacts[]>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [day, facts] of Object.entries(byDay)) {
    out[day] = facts.filter((f) => teamDayState(f) !== 'rest').length
  }
  return out
}

/** Le paramètre de semaine (?week=YYYY-Www) du jour cliqué — pour atterrir sur
 *  la BONNE semaine, pas sur la semaine courante. */
export function isoWeekParamOf(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`)
  // Jeudi de la semaine ISO → l'année ISO ne se trompe jamais aux frontières.
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const year = d.getUTCFullYear()
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}
