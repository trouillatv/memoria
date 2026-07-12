// Santé d'une action ouverte = pure fonction d'ancienneté (déterministe,
// anti-pointage). Module SANS dépendance serveur → importable côté client.
// 🔴 critique ≥ 14 j · 🟠 à surveiller 7–13 j · 🟢 en rythme < 7 j.

export type ActionHealth = 'critique' | 'surveiller' | 'rythme'

export function actionHealth(createdAtIso: string, nowMs: number = Date.now()): ActionHealth {
  const days = Math.floor((nowMs - new Date(createdAtIso).getTime()) / 86_400_000)
  if (days >= 14) return 'critique'
  if (days >= 7) return 'surveiller'
  return 'rythme'
}

// ── « Tu dois faire » (accueil) — quelle action mérite l'œil AUJOURD'HUI ? ────
// Audit Vincent 2026-07-12 : l'accueil appliquait le modèle âge→critique à des
// actions de SUIVI (routines sans échéance, vivantes par nature) → la même
// action était rouge « ? » sur l'accueil et grise « En suivi » dans /m/actions,
// tous les jours, à vie. UN SEUL modèle désormais — celui de /m/actions :
//   retard (échéance dépassée) 🔴 · à faire aujourd'hui 🟠 · en suivi = silence
//   sauf décrochage (aucune avancée depuis ≥ 7 j) 🟠.
// Une action REPORTÉE (motif posé) n'alarme plus : le report est un choix
// explicite du chef — sauf échéance dépassée, qui reste visible (🟠, jamais 🔴).

const NOUMEA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Noumea', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Jour civil Nouméa « YYYY-MM-DD » d'un instant ISO. */
export function noumeaDayOf(iso: string): string {
  return NOUMEA_DAY.format(new Date(iso))
}

/** Écart en jours civils entre deux « YYYY-MM-DD » (positif si to > from). */
function civilDays(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(toDay) - Date.parse(fromDay)) / 86_400_000)
}

export interface ActionAttention {
  severity: 'red' | 'orange'
  /** « en retard de 3 j » · « à faire aujourd'hui » · « pas d'avancée depuis 9 j »… */
  note: string
}

/** Seuil de décrochage d'un suivi : une routine sans AUCUNE avancée depuis
 *  autant de jours mérite l'œil (couvre un week-end sans harceler). */
export const FOLLOW_UP_STALL_DAYS = 7

/**
 * PUR (testable CI). `todayIso` = jour civil « YYYY-MM-DD » du lecteur.
 * Retourne null quand l'action ne doit PAS solliciter l'accueil aujourd'hui.
 */
export function actionAttentionOf(
  a: {
    due_date: string | null
    created_at: string
    last_progress_at: string | null
    snooze_reason: string | null
  },
  todayIso: string,
): ActionAttention | null {
  // Avancée déclarée aujourd'hui → on ne re-sollicite pas.
  if (a.last_progress_at && noumeaDayOf(a.last_progress_at) === todayIso) return null

  const due = a.due_date ? a.due_date.slice(0, 10) : null

  // Échéance dépassée : l'alarme légitime. Reportée → orange (le report est
  // un choix posé, mais l'échéance reste un fait) ; sinon rouge.
  if (due && due < todayIso) {
    const late = civilDays(due, todayIso)
    const lateLabel = late === 1 ? 'en retard de 1 j' : `en retard de ${late} j`
    return a.snooze_reason
      ? { severity: 'orange', note: `reportée · ${lateLabel}` }
      : { severity: 'red', note: lateLabel }
  }

  // Reportée (sans retard) : silence — le motif se lit dans /m/actions.
  if (a.snooze_reason) return null

  // Échéance aujourd'hui.
  if (due && due === todayIso) return { severity: 'orange', note: "à faire aujourd'hui" }

  // Échéance future : le rythme normal, rien à signaler.
  if (due) return null

  // Sans échéance = EN SUIVI : silence tant que le suivi vit ; décrochage
  // (aucune avancée depuis ≥ FOLLOW_UP_STALL_DAYS) → orange, jamais rouge.
  const lastTouch = a.last_progress_at ?? a.created_at
  const stalled = civilDays(noumeaDayOf(lastTouch), todayIso)
  if (stalled >= FOLLOW_UP_STALL_DAYS) {
    return { severity: 'orange', note: `en suivi · pas d'avancée depuis ${stalled} j` }
  }
  return null
}

export interface ActionNarration {
  text: string
  tone: 'bad' | 'warn' | 'muted'
}

/**
 * Transforme une couleur de santé en PHRASE (Vincent 2026-06-21). Raconte la
 * durée d'une action, à partir de la donnée déjà connue — zéro nouvelle table.
 *   « Ouverte depuis 143 j » · « Déclarée bloquée il y a 12 j » · « Déclarée
 *   faite il y a 3 j · à valider ». Répond à « pourquoi cette action est rouge ? ».
 * Pure, importable côté client.
 */
export function actionDurationNarration(
  input: {
    createdAt: string
    status: string
    extStatus?: 'done' | 'blocked' | null
    extAt?: string | null
  },
  nowMs: number = Date.now(),
): ActionNarration | null {
  if (input.status === 'done' || input.status === 'cancelled') return null
  const daysSince = (iso: string) => Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000))

  // Niveau 3 — un retour d'entreprise (QR) prime : il raconte la dernière évolution.
  if (input.extStatus === 'blocked' && input.extAt) {
    return { text: `Déclarée bloquée il y a ${daysSince(input.extAt)} j`, tone: 'bad' }
  }
  if (input.extStatus === 'done' && input.extAt) {
    return { text: `Déclarée faite il y a ${daysSince(input.extAt)} j · à valider`, tone: 'warn' }
  }

  // Niveau 1 — sinon, l'ancienneté d'ouverture, tonalité selon la santé.
  const d = daysSince(input.createdAt)
  const h = actionHealth(input.createdAt, nowMs)
  const tone = h === 'critique' ? 'bad' : h === 'surveiller' ? 'warn' : 'muted'
  return { text: `Ouverte depuis ${d} j`, tone }
}
