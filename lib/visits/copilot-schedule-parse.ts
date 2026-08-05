// Parsing déterministe date/heure pour les propositions de planification.
//
// Retourne null si la date est absente ou ambiguë → le Copilote demande une
// précision. Toutes les dates civiles sont en fuseau Pacific/Noumea (UTC+11).

import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

// ── Dictionnaires ─────────────────────────────────────────────────────────────

const DAY_OF_WEEK: Record<string, number> = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
}

// Accentué et non accentué — l'utilisateur peut taper "aout" comme "août".
const MONTH_MAP: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1,
  'février': 2, fevrier: 2, 'fév': 2, fev: 2,
  mars: 3,
  avril: 4, avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7, juil: 7,
  'août': 8, aout: 8,
  septembre: 9, sept: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  'décembre': 12, decembre: 12, 'déc': 12, dec: 12,
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ParsedSchedule = {
  date: string        // yyyy-mm-dd (date civile Nouméa)
  time: string | null // HH:MM ou null
}

// ── Helpers internes ──────────────────────────────────────────────────────────

function pad2(n: number): string { return n.toString().padStart(2, '0') }
function toYmd(y: number, m: number, d: number): string { return `${y}-${pad2(m)}-${pad2(d)}` }

// Prochain occurance de `targetDow` (0=Dim,1=Lun…6=Sam) après aujourd'hui.
// Si aujourd'hui est ce jour, retourne la semaine suivante.
function nextWeekday(todayIso: string, targetDow: number): string {
  const [y, m, d] = todayIso.split('-').map(Number)
  const todayDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  let delta = (targetDow - todayDow + 7) % 7
  if (delta === 0) delta = 7
  return addDaysLocal(todayIso, delta)
}

// ── Parsing heure ─────────────────────────────────────────────────────────────

/** "9h30", "9h", "14:30", "9 heures 30", "9 heures", "9 h" → "HH:MM" ; null si absent ou invalide. */
export function parseTime(text: string): string | null {
  // Format compact : "9h30", "09h", "14:30" — h ou : collé au chiffre
  const m1 = text.match(/\b(\d{1,2})[h:](\d{0,2})\b/)
  if (m1) {
    const h = parseInt(m1[1], 10)
    const min = m1[2] ? parseInt(m1[2], 10) : 0
    if (h <= 23 && min <= 59) return `${pad2(h)}:${pad2(min)}`
  }

  // "9 heures 30", "9 h 30" — heure en toutes lettres avec minutes
  const m2 = text.match(/\b(\d{1,2})\s+(?:heures?|h)\s+(\d{1,2})\b/i)
  if (m2) {
    const h = parseInt(m2[1], 10)
    const min = parseInt(m2[2], 10)
    if (h <= 23 && min <= 59) return `${pad2(h)}:${pad2(min)}`
  }

  // "9 heures", "9 heure", "9 h" — heure seule avec espace
  const m3 = text.match(/\b(\d{1,2})\s+(?:heures?|h)\b/i)
  if (m3) {
    const h = parseInt(m3[1], 10)
    if (h <= 23) return `${pad2(h)}:00`
  }

  return null
}

// ── Parsing date ──────────────────────────────────────────────────────────────

/**
 * Extrait une date (et une heure optionnelle) d'une question en français.
 * Retourne null si aucune date reconnue → le Copilote demandera une précision.
 *
 * Reconnaissance dans l'ordre de priorité :
 *   1. Relatifs : aujourd'hui, demain, après-demain
 *   2. Noms de jours : "lundi", "vendredi prochain"
 *   3. ISO yyyy-mm-dd
 *   4. Format numérique : "8/08", "8/08/2026"
 *   5. Textuel : "8 août", "8 août 2026", "le 8 août"
 */
export function parseScheduleFromQuestion(question: string, todayIso?: string): ParsedSchedule | null {
  const today = todayIso ?? todayLocalIso()
  const currentYear = parseInt(today.slice(0, 4), 10)
  const q = question.toLowerCase()

  let date: string | null = null

  // 1. Relatifs stricts
  if (/\baujourd['']?hui\b/.test(q)) {
    date = today
  } else if (/\bapr[eè]s[-\s]?demain\b/.test(q)) {
    date = addDaysLocal(today, 2)
  } else if (/\bdemain\b/.test(q)) {
    date = addDaysLocal(today, 1)
  }

  // 2. Noms de jours ("vendredi", "vendredi prochain", "lundi prochain")
  if (!date) {
    for (const [name, dow] of Object.entries(DAY_OF_WEEK)) {
      if (new RegExp(`\\b${name}\\b`).test(q)) {
        date = nextWeekday(today, dow)
        break
      }
    }
  }

  // 3. ISO yyyy-mm-dd
  if (!date) {
    const m = question.match(/\b(20\d\d)-(\d{2})-(\d{2})\b/)
    if (m) date = `${m[1]}-${m[2]}-${m[3]}`
  }

  // 4. dd/mm ou dd/mm/yyyy
  if (!date) {
    const m = question.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/)
    if (m) {
      const d = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10)
      const y = m[3] ? parseInt(m[3], 10) : currentYear
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) date = toYmd(y, mo, d)
    }
  }

  // 5. "8 août", "8 août 2026", "le 8 août" — trier les clés par longueur décroissante
  //    pour éviter que "jan" matche avant "janvier".
  if (!date) {
    const keys = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length)
    const monthPat = keys.join('|')
    const re = new RegExp(`(?:le\\s+)?(\\d{1,2})\\s+(${monthPat})(?:\\s+(20\\d\\d))?`, 'i')
    const m = q.match(re)
    if (m) {
      const d = parseInt(m[1], 10)
      const monthNum = MONTH_MAP[m[2].toLowerCase()] ?? null
      const y = m[3] ? parseInt(m[3], 10) : currentYear
      if (d >= 1 && d <= 31 && monthNum) date = toYmd(y, monthNum, d)
    }
  }

  if (!date) return null
  // Date passée (avant aujourd'hui) → pas de proposition silencieuse avec une mauvaise date.
  // "aujourd'hui" = today → autorisé ; hier ou avant → clarification.
  if (date < today) return null
  if (date > `${currentYear + 2}-12-31`) return null

  return { date, time: parseTime(question) }
}

// ── Conversion vers timestamptz ───────────────────────────────────────────────

/**
 * Construit un timestamptz ISO 8601 depuis une date + heure en Pacific/Noumea.
 * Noumea = UTC+11 (pas de DST).
 * "2026-08-08" + "09:00" → "2026-08-08T09:00:00+11:00"
 */
export function toNomeaTimestamp(date: string, time: string): string {
  return `${date}T${time}:00+11:00`
}

// ── Formatage lisible pour whyText ────────────────────────────────────────────

/**
 * "2026-08-08" + "09:00" → "le samedi 8 août 2026 à 09:00"
 * La date est déjà en calendrier civil Noumea — on formate via UTC noon pour
 * éviter tout décalage de fuseau dans l'affichage.
 */
export function formatScheduleLabel(date: string, time: string | null): string {
  try {
    const d = new Date(`${date}T12:00:00Z`)
    const fmt = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const dateStr = fmt.format(d)
    return time ? `le ${dateStr} à ${time}` : `le ${dateStr}`
  } catch {
    return time ? `le ${date} à ${time}` : `le ${date}`
  }
}
