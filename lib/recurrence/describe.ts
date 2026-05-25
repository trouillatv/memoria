// Phase 6 — Recurrence simple — Slice 6.2
//
// Genere une phrase descriptive 100% francaise parlee a partir d'un template
// (intervention_templates). Strictement aligne sur la doctrine UX :
//   - Pas de "template" ni "planning" dans la sortie.
//   - Creneaux nommes (Matin / Apres-midi / Soir), jamais d'horaires precis.
//   - Phrase complete, pas de jargon technique.

import type { DbInterventionTemplate, InterventionSlot } from '@/types/db'

const DAYS_FR: Record<number, string> = {
  1: 'lundis',
  2: 'mardis',
  3: 'mercredis',
  4: 'jeudis',
  5: 'vendredis',
  6: 'samedis',
  7: 'dimanches',
}

const SLOT_LABEL_FR: Record<InterventionSlot, string> = {
  morning: 'matin',
  afternoon: 'après-midi',
  evening: 'soir',
}

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/**
 * Formate une date ISO (YYYY-MM-DD) en francais lisible : "11 mai 2026".
 */
export function formatDateFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const monthName = MONTHS_FR[month - 1] ?? ''
  return `${day} ${monthName} ${year}`
}

/**
 * Joint des libelles de creneaux en francais parle.
 * - 1 -> "matin"
 * - 2 -> "matin et soir"
 * - 3 -> "matin, apres-midi et soir"
 */
export function joinSlotsFr(slots: InterventionSlot[] | null | undefined): string {
  if (!slots || slots.length === 0) return ''
  const labels = slots.map((s) => SLOT_LABEL_FR[s])
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} et ${labels[1]}`
  const head = labels.slice(0, -1).join(', ')
  const tail = labels[labels.length - 1]
  return `${head} et ${tail}`
}

/**
 * Phrase descriptive d'une recurrence en francais parle.
 *
 * Exemples :
 *   "Tous les jours, matin et soir, a partir du 11 mai 2026"
 *   "Du lundi au vendredi, matin, a partir du 11 mai 2026"
 *   "Tous les mardis, apres-midi, a partir du 11 mai 2026"
 *   "Tous les 15 du mois, a partir du 11 mai 2026"
 *   "Le 11 mai 2026" (one_shot, slots vides)
 */
/** "06:30" → "06h30". */
function fmtHHMM(hhmm: string): string {
  return hhmm.replace(':', 'h')
}

export function describeTemplate(t: DbInterventionTemplate): string {
  // Migration 085 — heure précise si définie ; sinon créneau (legacy).
  const slotsPart = t.planned_start_hhmm
    ? t.planned_end_hhmm
      ? `${fmtHHMM(t.planned_start_hhmm)}–${fmtHHMM(t.planned_end_hhmm)}`
      : fmtHHMM(t.planned_start_hhmm)
    : joinSlotsFr(t.slots)

  if (t.frequency === 'one_shot') {
    const datePart = formatDateFr(t.starts_on)
    return slotsPart ? `Le ${datePart}, ${slotsPart}` : `Le ${datePart}`
  }

  let frequencyPart = ''
  switch (t.frequency) {
    case 'daily':
      frequencyPart = 'Tous les jours'
      break
    case 'weekdays':
      frequencyPart = 'Du lundi au vendredi'
      break
    case 'weekly': {
      const dayLabel = t.day_of_week ? DAYS_FR[t.day_of_week] : null
      frequencyPart = dayLabel ? `Tous les ${dayLabel}` : 'Une fois par semaine'
      break
    }
    case 'monthly': {
      if (t.day_of_month) {
        const suffix = t.day_of_month === 1 ? 'er' : ''
        frequencyPart = `Tous les ${t.day_of_month}${suffix} du mois`
      } else {
        frequencyPart = 'Une fois par mois'
      }
      break
    }
  }

  const startsPart = `à partir du ${formatDateFr(t.starts_on)}`
  return slotsPart
    ? `${frequencyPart}, ${slotsPart}, ${startsPart}`
    : `${frequencyPart}, ${startsPart}`
}
