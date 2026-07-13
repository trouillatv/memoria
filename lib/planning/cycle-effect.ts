// La DATE D'EFFET d'une modification de roulement — et pourquoi on la demande.
//
// « Guillaume modifie un jeudi. » Que veut-il dire ?
//
//   « je me suis trompé »         → réécrire la règle depuis le début ;
//   « à partir de maintenant »    → le passé reste vrai ;
//   « à partir de lundi »         → la semaine en cours reste vraie ;
//   « à partir du 1er septembre » → il prépare la rentrée.
//
// Ces quatre intentions existent réellement. Deviner, c'est ranger le futur au
// mauvais endroit — alors on DEMANDE, toujours.
//
// Pur : aucune base, aucun réseau. Testable à sec.

export type EffectChoice = 'rewrite' | 'immediate' | 'next_monday' | 'date'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

function shift(dateIso: string, days: number): string {
  return new Date(new Date(`${dateIso}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

/** La veille — c'est le dernier jour de l'ancienne version. */
export function previousDayIso(dateIso: string): string {
  return shift(dateIso, -1)
}

/** Le prochain lundi STRICTEMENT après aujourd'hui. Un lundi ne se désigne pas
 *  lui-même : « à partir de lundi prochain » dit toujours la semaine d'après. */
export function nextMondayIso(todayIso: string): string {
  const d = new Date(`${todayIso}T00:00:00.000Z`)
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay() // 1 = lundi … 7 = dimanche
  return shift(todayIso, 8 - dow)
}

/**
 * La date à laquelle la modification prend effet.
 *
 * `null` = réécriture : pas de nouvelle version, la règle est corrigée sur
 * place. C'est le geste « je me suis trompé » — il réécrit la RÈGLE, jamais
 * l'histoire (les interventions déjà générées et leurs preuves restent).
 */
export function resolveEffectiveDate(
  choice: EffectChoice,
  customDate: string | null,
  todayIso: string,
): { date: string | null } | { error: string } {
  switch (choice) {
    case 'rewrite':
      return { date: null }
    case 'immediate':
      return { date: todayIso }
    case 'next_monday':
      return { date: nextMondayIso(todayIso) }
    case 'date': {
      if (!customDate || !ISO.test(customDate)) return { error: 'Choisissez la date d’effet' }
      // Le passé ne se re-décide pas : une date d'effet d'hier réécrirait des
      // jours déjà vécus — c'est le geste « rewrite », et il doit être assumé.
      if (customDate < todayIso) return { error: 'La date d’effet est déjà passée' }
      return { date: customDate }
    }
  }
}

/**
 * La coupure entre deux versions.
 *
 * L'ancienne version s'arrête LA VEILLE de la date d'effet : aucun jour n'est
 * couvert deux fois, aucun jour n'est orphelin.
 */
export function splitAt(effectiveFrom: string): { oldEndsOn: string } {
  return { oldEndsOn: previousDayIso(effectiveFrom) }
}

/**
 * Une date d'effet a-t-elle un sens pour CE roulement ?
 *
 * Si elle tombe avant (ou sur) son premier jour, il n'y a rien à découper :
 * c'est une réécriture qui ne dit pas son nom — on la traite comme telle.
 */
export function isRealSplit(effectiveFrom: string, cycleStartsOn: string): boolean {
  return effectiveFrom > cycleStartsOn
}
