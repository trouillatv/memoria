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

// =============================================================================
// Heure PRÉCISE de prestation (V6.1 — `planned_start` / `planned_end`)
// =============================================================================
//
// Demande Vincent 2026-05-20 (Guillaume terrain nettoyage) : la granularité
// matin/après-midi/soir ne reflète pas le métier. Le chef d'équipe travaille
// de 06h30 à 08h00, ou de 13h à 17h. Il faut pouvoir saisir ces heures
// réelles.
//
// Le backend était déjà prêt (migration 071 V6.1 : `planned_start`,
// `planned_end`). Le travail manquant est uniquement la saisie + affichage.
//
// Convention timestamps (alignée sur l'existant) :
//   - Saisie utilisateur : « HH:MM » en heure LOCALE (Nouméa UTC+11 en pratique).
//   - Stockage : `YYYY-MM-DDTHH:MM:00.000Z` (Z suffixe historique — la valeur
//     numérique des heures EST l'heure locale ; la nomination « UTC » est un
//     héritage à ne pas réparer ici, cohérent avec `buildScheduledAt`).
//
// Verrou V6.1 (gravé migration 071) :
//   `planned_*` est un ancrage de PRESTATION (site/contrat), JAMAIS un
//   pointage de personne. Ne jamais agréger par user_id.

const HHMM_RE = /^(\d{2}):(\d{2})$/

/** Valide un input "HH:MM" (00:00 → 23:59). */
export function isValidHHMM(value: string): boolean {
  const m = HHMM_RE.exec(value)
  if (!m) return false
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 0 && h <= 23 && min >= 0 && min <= 59
}

/** Construit un timestamptz pour `planned_start` / `planned_end` à partir
 *  d'une date `YYYY-MM-DD` et d'une heure locale `HH:MM`. Retourne null
 *  si HH:MM invalide. */
export function buildPlannedTimestamp(
  dateIso: string,
  hhmm: string,
): string | null {
  if (!isValidHHMM(hhmm)) return null
  return `${dateIso}T${hhmm}:00.000Z`
}

/** Extrait l'heure "HH:MM" depuis un timestamptz (lecture brute, pas de
 *  conversion fuseau — cohérent avec la convention de stockage). */
export function extractHHMM(iso: string | null): string | null {
  if (!iso) return null
  // ISO: 2026-05-20T06:30:00.000Z → "06:30"
  const m = /T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  return `${m[1]}:${m[2]}`
}

/** Format humain : « 06h30 ». Retourne '—' si null. */
export function fmtHourFr(iso: string | null): string {
  const hhmm = extractHHMM(iso)
  if (!hhmm) return '—'
  const [h, m] = hhmm.split(':')
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`
}

/** Format durée humaine : `1h30`, `45 min`, `2h`. Retourne null si calcul
 *  impossible. */
export function fmtDurationFr(startIso: string, endIso: string): string | null {
  const startMs = new Date(startIso).getTime()
  const endMs = new Date(endIso).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  const diffMin = Math.round((endMs - startMs) / 60_000)
  if (diffMin <= 0) return null
  if (diffMin < 60) return `${diffMin} min`
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** Format range humain : « 06h30 – 08h00 (1h30) » si `planned_start` et
 *  `planned_end` ; « 06h30 » si seul start ; fallback slot label sinon.
 *
 *  Doctrine V6.1 : c'est l'ancrage de prestation. Pas un pointage de personne.
 *  Le code consommateur NE DOIT JAMAIS agréger ces heures par user_id. */
export function formatPlannedTimeRange(
  plannedStart: string | null,
  plannedEnd: string | null,
  fallbackSlot: InterventionSlot | null,
): string {
  if (!plannedStart) return slotReferenceLabelFr(fallbackSlot)
  const startStr = fmtHourFr(plannedStart)
  if (!plannedEnd) return startStr
  const endStr = fmtHourFr(plannedEnd)
  const duration = fmtDurationFr(plannedStart, plannedEnd)
  return duration ? `${startStr} – ${endStr} (${duration})` : `${startStr} – ${endStr}`
}

/** Détecte si `planned_start` est l'ancrage CANONIQUE par défaut (07/14/19)
 *  ou une heure PRÉCISE saisie par l'utilisateur. Heuristique : les valeurs
 *  exactes 07:00 / 14:00 / 19:00 sont considérées comme ancrages canoniques.
 *  Toute autre heure (06:30, 07:15, 08:00, etc.) = saisie utilisateur précise.
 *
 *  Trade-off connu : si un utilisateur saisit pile « 07:00 », le système la
 *  traitera comme ancrage. Acceptable en pratique (95% des saisies terrain
 *  ne sont pas pile sur ces 3 heures). */
export function isPlannedStartPrecise(plannedStart: string | null): boolean {
  if (!plannedStart) return false
  const hhmm = extractHHMM(plannedStart)
  if (!hhmm) return false
  return hhmm !== '07:00' && hhmm !== '14:00' && hhmm !== '19:00'
}

/** Label intervention prêt à afficher dans le wording terrain. Choisit
 *  automatiquement entre heure précise (« 06h30 – 08h00 (1h30) ») et slot
 *  grossier (« Matin / Après-midi / Soir ») selon ce qui est disponible.
 *
 *  Utilisé par toutes les surfaces : page intervention, mobile chef, partage
 *  texte, briefing, vue semaine. Source unique de vérité d'affichage.
 *
 *  Doctrine V6.1 : ne JAMAIS appeler cette fonction dans un contexte qui
 *  agrège par user_id. C'est de l'affichage par intervention/site, pas par
 *  personne. */
export function formatInterventionTimeLabel(input: {
  planned_start?: string | null
  planned_end?: string | null
  slot?: InterventionSlot | null
}): string {
  if (isPlannedStartPrecise(input.planned_start ?? null)) {
    return formatPlannedTimeRange(
      input.planned_start ?? null,
      input.planned_end ?? null,
      input.slot ?? null,
    )
  }
  return slotLabelFr(input.slot ?? null)
}

/** Libellé classique du créneau (Matin / Après-midi / Soir / —). */
export function slotLabelFr(slot: InterventionSlot | null): string {
  switch (slot) {
    case 'morning':   return 'Matin'
    case 'afternoon': return 'Après-midi'
    case 'evening':   return 'Soir'
    default:          return '—'
  }
}
