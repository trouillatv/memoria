// Slice M1 — Texte format pour partage WhatsApp/email.
//
// Doctrine V5 Pilier 3 : MemorIA produit le texte, l'humain colle dans
// l'outil dominant (WhatsApp). Pas d'emoji excessif, pas d'injonction, pas
// d'auto-promo MemorIA dans le message (pilier 6 : infrastructure invisible).
//
// V6.1 (Vincent 2026-05-20 — demande Guillaume) : si `planned_start` est une
// heure PRÉCISE saisie (ex. 06h30), on l'affiche à la place du créneau grossier
// (« créneau matin »). Le métier nettoyage vit en heures réelles, pas en
// catégories abstraites.

import { formatInterventionTimeLabel, isPlannedStartPrecise } from '@/lib/time/prestation-slot'
import type { InterventionSlot } from '@/types/db'

const MONTHS_FR_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

const WEEKDAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']

const SLOT_FR: Record<string, string> = {
  morning: 'créneau matin',
  afternoon: 'créneau après-midi',
  evening: 'créneau soir',
}

/**
 * Construit le message WhatsApp pour une intervention.
 *
 * Exemples :
 *   « CHT Magenta — Bionettoyage bloc B
 *     Mardi 14 mai, créneau matin »                ← legacy slot
 *
 *   « CHT Magenta — Bionettoyage bloc B
 *     Mardi 14 mai, 06h30 – 08h00 (1h30) »         ← V6.1 heure précise
 *
 * L'appelant ajoute ensuite l'URL : `${text}\nDétails : ${url}`
 */
export function formatInterventionShareText(input: {
  missionName: string
  siteName: string
  scheduledFor: string // yyyy-mm-dd
  slot: string | null
  /** V6.1 — `planned_start` timestamptz. Si précis (≠ ancrage 07/14/19),
   *  remplace le wording « créneau matin » par « 06h30 – 08h00 (1h30) ». */
  plannedStart?: string | null
  plannedEnd?: string | null
}): string {
  const { missionName, siteName, scheduledFor, slot, plannedStart, plannedEnd } = input
  const date = new Date(scheduledFor + 'T00:00:00Z')
  const weekday = WEEKDAYS_FR[date.getUTCDay()] ?? ''
  const day = date.getUTCDate()
  const month = MONTHS_FR_SHORT[date.getUTCMonth()] ?? ''
  const dateText = `${weekday} ${day} ${month}`

  // V6.1 : si heure précise saisie, on l'utilise. Sinon fallback slot grossier
  // (« créneau matin »).
  let timeText: string
  if (isPlannedStartPrecise(plannedStart ?? null)) {
    timeText = formatInterventionTimeLabel({
      planned_start: plannedStart ?? null,
      planned_end: plannedEnd ?? null,
      slot: (slot as InterventionSlot | null) ?? null,
    })
  } else {
    timeText = slot ? SLOT_FR[slot] ?? '' : ''
  }

  return [
    `${siteName} — ${missionName}`,
    [dateText, timeText].filter(Boolean).join(', '),
  ].join('\n')
}
