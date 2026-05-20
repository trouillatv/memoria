// Slice M1 — Texte format pour partage WhatsApp/email.
//
// Doctrine V5 Pilier 3 : MemorIA produit le texte, l'humain colle dans
// l'outil dominant (WhatsApp). Pas d'emoji excessif, pas d'injonction, pas
// d'auto-promo MemorIA dans le message (pilier 6 : infrastructure invisible).
//
// V6.1 (Vincent 2026-05-20) : zéro évocation de « créneau » côté utilisateur.
// On affiche UNIQUEMENT l'heure (précise si saisie, ancrage canonique sinon).
// Le métier nettoyage vit en heures réelles, pas en catégories abstraites.

import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import type { InterventionSlot } from '@/types/db'

const MONTHS_FR_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

const WEEKDAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']

/**
 * Construit le message WhatsApp pour une intervention.
 *
 * Exemples (V6.1, heure obligatoire) :
 *   « CHT Magenta — Bionettoyage bloc B
 *     Mardi 14 mai, 06h30 – 08h00 (1h30) »          ← heure précise
 *
 *   « CHT Magenta — Bionettoyage bloc B
 *     Mardi 14 mai, 7h »                            ← ancrage canonique legacy
 *
 * L'appelant ajoute ensuite l'URL : `${text}\nDétails : ${url}`
 */
export function formatInterventionShareText(input: {
  missionName: string
  siteName: string
  scheduledFor: string // yyyy-mm-dd
  slot: string | null
  /** V6.1 — `planned_start` timestamptz (heure de prestation). */
  plannedStart?: string | null
  plannedEnd?: string | null
}): string {
  const { missionName, siteName, scheduledFor, slot, plannedStart, plannedEnd } = input
  const date = new Date(scheduledFor + 'T00:00:00Z')
  const weekday = WEEKDAYS_FR[date.getUTCDay()] ?? ''
  const day = date.getUTCDate()
  const month = MONTHS_FR_SHORT[date.getUTCMonth()] ?? ''
  const dateText = `${weekday} ${day} ${month}`

  // V6.1 (Vincent 2026-05-20) : heure UNIQUEMENT, jamais le mot « créneau ».
  // formatInterventionTimeLabel retombe sur l'ancrage canonique (7h / 14h /
  // 19h) si pas d'heure précise saisie — jamais sur « matin ».
  const timeText = formatInterventionTimeLabel({
    planned_start: plannedStart ?? null,
    planned_end: plannedEnd ?? null,
    slot: (slot as InterventionSlot | null) ?? null,
  })

  return [
    `${siteName} — ${missionName}`,
    [dateText, timeText].filter(Boolean).join(', '),
  ].join('\n')
}
