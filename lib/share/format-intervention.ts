// Slice M1 — Texte format pour partage WhatsApp/email.
//
// Doctrine V5 Pilier 3 : MemorIA produit le texte, l'humain colle dans
// l'outil dominant (WhatsApp). Pas d'emoji excessif, pas d'injonction, pas
// d'auto-promo MemorIA dans le message (pilier 6 : infrastructure invisible).

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
 * Exemple :
 *   « 🏥 CHT Magenta — Bionettoyage bloc B
 *     Mardi 14 mai, créneau matin »
 *
 * L'appelant ajoute ensuite l'URL : `${text}\nDétails : ${url}`
 */
export function formatInterventionShareText(input: {
  missionName: string
  siteName: string
  scheduledFor: string // yyyy-mm-dd
  slot: string | null
}): string {
  const { missionName, siteName, scheduledFor, slot } = input
  const date = new Date(scheduledFor + 'T00:00:00Z')
  const weekday = WEEKDAYS_FR[date.getUTCDay()] ?? ''
  const day = date.getUTCDate()
  const month = MONTHS_FR_SHORT[date.getUTCMonth()] ?? ''
  const dateText = `${weekday} ${day} ${month}`
  const slotText = slot ? SLOT_FR[slot] ?? '' : ''
  return [
    `${siteName} — ${missionName}`,
    [dateText, slotText].filter(Boolean).join(', '),
  ].join('\n')
}
