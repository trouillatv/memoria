// LE CALENDRIER CALÉDONIEN 2026 — jours fériés et vacances scolaires.
//
// Pourquoi une donnée écrite à la main, et pas une librairie : le calendrier
// calédonien ne se déduit pas d'une règle métropolitaine. La Fête locale du
// 24 septembre n'existe nulle part ailleurs, et les vacances scolaires suivent
// l'hémisphère sud — l'année scolaire commence en février et finit en décembre.
// C'est pourquoi l'écran Calendrier ne pré-remplit rien : il ne devine pas.
//
// Ce module ne DÉCIDE rien non plus. Il propose des dates ; un humain les
// importe. Une période importée devient une période comme une autre : modifiable,
// supprimable, et c'est elle — pas ce fichier — qui fait autorité ensuite.
//
// Source : Vincent, 2026-07-14.
//
// Pur : aucune base, aucun réseau.

import type { CalendarKind } from '@/lib/db/school-calendar'

export interface CalendarSeed {
  kind: CalendarKind
  label: string
  /** yyyy-mm-dd */
  startsOn: string
  /** yyyy-mm-dd — égal à startsOn pour un jour férié. */
  endsOn: string
}

/** Les jours fériés 2026 en Nouvelle-Calédonie. Un férié dure un jour. */
export const NC_HOLIDAYS_2026: readonly CalendarSeed[] = [
  { kind: 'ferie', label: "Jour de l'an", startsOn: '2026-01-01', endsOn: '2026-01-01' },
  { kind: 'ferie', label: 'Lundi de Pâques', startsOn: '2026-04-06', endsOn: '2026-04-06' },
  { kind: 'ferie', label: 'Fête du travail', startsOn: '2026-05-01', endsOn: '2026-05-01' },
  { kind: 'ferie', label: 'Victoire 1945', startsOn: '2026-05-08', endsOn: '2026-05-08' },
  { kind: 'ferie', label: 'Ascension', startsOn: '2026-05-14', endsOn: '2026-05-14' },
  { kind: 'ferie', label: 'Lundi de Pentecôte', startsOn: '2026-05-25', endsOn: '2026-05-25' },
  { kind: 'ferie', label: 'Fête nationale', startsOn: '2026-07-14', endsOn: '2026-07-14' },
  { kind: 'ferie', label: 'Assomption', startsOn: '2026-08-15', endsOn: '2026-08-15' },
  { kind: 'ferie', label: 'Fête locale', startsOn: '2026-09-24', endsOn: '2026-09-24' },
  { kind: 'ferie', label: 'Toussaint', startsOn: '2026-11-01', endsOn: '2026-11-01' },
  { kind: 'ferie', label: 'Armistice', startsOn: '2026-11-11', endsOn: '2026-11-11' },
  { kind: 'ferie', label: 'Noël', startsOn: '2026-12-25', endsOn: '2026-12-25' },
] as const

/**
 * Les vacances scolaires 2026. Elles ferment les chantiers qui SUIVENT le
 * calendrier — jamais les autres : un magasin reste ouvert quand l'école ferme.
 *
 * Les vacances d'été n'ont pas de fin ici : elles courent sur l'année scolaire
 * suivante, qui n'est pas encore publiée. La période s'arrête donc au 31
 * décembre 2026, et 2027 se saisira quand ses dates seront connues.
 */
export const NC_SCHOOL_HOLIDAYS_2026: readonly CalendarSeed[] = [
  { kind: 'scolaire', label: 'Vacances 1ʳᵉ période', startsOn: '2026-04-04', endsOn: '2026-04-19' },
  { kind: 'scolaire', label: 'Vacances 2ᵉ période', startsOn: '2026-06-06', endsOn: '2026-06-21' },
  { kind: 'scolaire', label: 'Vacances 3ᵉ période', startsOn: '2026-08-08', endsOn: '2026-08-23' },
  { kind: 'scolaire', label: 'Vacances 4ᵉ période', startsOn: '2026-10-10', endsOn: '2026-10-25' },
  { kind: 'scolaire', label: "Vacances d'été", startsOn: '2026-12-19', endsOn: '2026-12-31' },
] as const

export const NC_CALENDAR_2026: readonly CalendarSeed[] = [
  ...NC_HOLIDAYS_2026,
  ...NC_SCHOOL_HOLIDAYS_2026,
]

/**
 * Ce qui MANQUE encore, comparé à ce qui existe déjà.
 *
 * Une période est « déjà là » si une période du même type couvre exactement les
 * mêmes dates — le libellé peut différer (« Noël » / « Noël 2026 ») sans que ce
 * soit un doublon. L'import est donc rejouable sans jamais créer deux fois la
 * même fermeture.
 */
export function missingFrom(
  existing: ReadonlyArray<{ kind: CalendarKind; startsOn: string; endsOn: string }>,
  seeds: readonly CalendarSeed[] = NC_CALENDAR_2026,
): CalendarSeed[] {
  const known = new Set(existing.map((p) => `${p.kind}::${p.startsOn}::${p.endsOn}`))
  return seeds.filter((s) => !known.has(`${s.kind}::${s.startsOn}::${s.endsOn}`))
}
