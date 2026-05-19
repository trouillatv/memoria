// =============================================================================
// Module canonique slot ↔ heure de prestation — SOURCE UNIQUE DE VÉRITÉ
// =============================================================================
//
// Constat fondateur (exploitation-doctrine-V6.md, audit 2026-05-18) :
// `interventions.scheduled_at` était dérivé par des mappings slot→heure
// DIVERGENTS selon le chemin de code — 6/12/18 (création, spontané),
// 7/13/18 (vue semaine), 8/14/19 (récurrences), plus 7h/14h/19h à l'affichage
// et deux reverse `h<12 / h<17` dupliqués. Le système stockait une fausse
// heure précise, incohérente. Pour un même créneau « matin » le chef d'équipe
// pouvait lire « 7h » là où la récurrence avait écrit 08:00Z et la création
// 06:00Z. La preuve de prestation — le cœur du produit — reposait sur une
// heure fausse.
//
// V6.1 « inverse la flèche » : un seul ancrage canonique ; le slot est un
// LABEL GROSSIER dérivé, jamais une heure jugée. Interdit V6.1 : présenter
// cette heure comme un horaire précis ou un écart (« 12 min de retard »).
// C'est un ancrage de tri/stockage, pas un pointage.
//
// Valeurs canoniques = 07/14/19 UTC : ce sont les seules déjà human-facing
// (chef-equipe-preparation.ts affichait « 7h / 14h / 19h ») → bascule à zéro
// changement visible pour le chef d'équipe. Les bornes reverse `h<12 / h<17`
// classent correctement les heures des 3 anciens mappings (6/7/8 → morning,
// 12/13/14 → afternoon, 18/19 → evening) : un `scheduled_at` legacy se relit
// au bon slot SANS réécriture — stratégie additive non destructive
// (arbitrage Vincent, 2026-05-19).
//
// Tout nouveau mapping slot→heure hors de ce module est interdit et
// verrouillé par test (tests/doctrine/prestation-slot-canonical.test.ts).

import type { InterventionSlot } from '@/types/db'

/** Ancrage horaire UTC canonique d'un créneau. Grossier, jamais « précis ». */
export const SLOT_UTC_HOUR: Readonly<Record<InterventionSlot, number>> = {
  morning: 7,
  afternoon: 14,
  evening: 19,
}

/** Heure UTC d'un slot. `null` → ancrage matin (défaut historique stable). */
export function slotToUtcHour(slot: InterventionSlot | null): number {
  return slot ? SLOT_UTC_HOUR[slot] : SLOT_UTC_HOUR.morning
}

/**
 * Timestamptz UTC stable dérivé d'une date civile `YYYY-MM-DD` + slot.
 * Remplace les `${date}T${hh}:00:00.000Z` éparpillés.
 */
export function buildScheduledAt(
  dateIso: string,
  slot: InterventionSlot | null,
): string {
  const hh = String(slotToUtcHour(slot)).padStart(2, '0')
  return `${dateIso}T${hh}:00:00.000Z`
}

/**
 * Slot depuis une heure UTC. Bornes larges et stables : elles classent les
 * heures des 3 mappings legacy au bon slot (reverse non destructif). NE PAS
 * resserrer sans migration de données : un legacy 18h doit rester `evening`.
 */
export function slotFromUtcHour(hour: number): InterventionSlot {
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

/** Slot dérivé d'un `scheduled_at` (timestamptz). */
export function slotFromScheduledAt(scheduledAt: string): InterventionSlot {
  return slotFromUtcHour(new Date(scheduledAt).getUTCHours())
}

/** Slot courant depuis un instant (par défaut maintenant). */
export function currentSlot(now: Date = new Date()): InterventionSlot {
  return slotFromUtcHour(now.getUTCHours())
}

/**
 * Libellé « heure de référence » grossier d'un slot (UX mobile). C'est un
 * REPÈRE, jamais un horaire précis ni un écart jugé (interdit V6.1).
 */
export function slotReferenceLabelFr(slot: InterventionSlot | null): string {
  return slot ? `${SLOT_UTC_HOUR[slot]}h` : '—'
}
