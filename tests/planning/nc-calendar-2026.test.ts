// LE CALENDRIER CALÉDONIEN 2026.
//
// Ce qu'on protège :
//   • les DATES — une date fausse ferme un chantier le mauvais jour, ou laisse
//     une équipe se déplacer un jour férié. C'est le genre d'erreur qu'on ne
//     voit qu'une fois sur place ;
//   • l'IMPORT REJOUABLE — cliquer deux fois ne doit pas produire deux Noël ;
//   • le fait qu'un férié dure UN jour, et qu'une période de vacances tienne
//     debout (fin ≥ début).

import { describe, it, expect } from 'vitest'
import {
  NC_CALENDAR_2026,
  NC_HOLIDAYS_2026,
  NC_SCHOOL_HOLIDAYS_2026,
  missingFrom,
} from '@/lib/planning/nc-calendar-2026'

/** Le jour de la semaine, en clair — c'est ainsi que Vincent a donné les dates. */
function weekdayFr(iso: string): string {
  const noms = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
  return noms[new Date(`${iso}T00:00:00.000Z`).getUTCDay()]
}

describe('Les jours fériés 2026', () => {
  it('sont les douze de la Nouvelle-Calédonie, aux bons jours de la semaine', () => {
    expect(NC_HOLIDAYS_2026).toHaveLength(12)

    const attendu: Array<[string, string, string]> = [
      ['2026-01-01', 'jeudi', "Jour de l'an"],
      ['2026-04-06', 'lundi', 'Lundi de Pâques'],
      ['2026-05-01', 'vendredi', 'Fête du travail'],
      ['2026-05-08', 'vendredi', 'Victoire 1945'],
      ['2026-05-14', 'jeudi', 'Ascension'],
      ['2026-05-25', 'lundi', 'Lundi de Pentecôte'],
      ['2026-07-14', 'mardi', 'Fête nationale'],
      ['2026-08-15', 'samedi', 'Assomption'],
      ['2026-09-24', 'jeudi', 'Fête locale'],
      ['2026-11-01', 'dimanche', 'Toussaint'],
      ['2026-11-11', 'mercredi', 'Armistice'],
      ['2026-12-25', 'vendredi', 'Noël'],
    ]

    for (const [date, jour, label] of attendu) {
      const f = NC_HOLIDAYS_2026.find((h) => h.startsOn === date)
      expect(f, `${label} manque`).toBeDefined()
      expect(f!.label).toBe(label)
      // La Fête locale du 24 septembre n'existe nulle part ailleurs : aucune
      // librairie métropolitaine ne l'aurait devinée.
      expect(weekdayFr(date), `${label} tombe un ${weekdayFr(date)}`).toBe(jour)
    }
  })

  it('durent un seul jour', () => {
    for (const h of NC_HOLIDAYS_2026) {
      expect(h.endsOn).toBe(h.startsOn)
    }
  })
})

describe('Les vacances scolaires 2026', () => {
  it('sont les cinq périodes, du samedi au dimanche', () => {
    expect(NC_SCHOOL_HOLIDAYS_2026).toHaveLength(5)

    const p1 = NC_SCHOOL_HOLIDAYS_2026[0]
    expect(p1.startsOn).toBe('2026-04-04')
    expect(p1.endsOn).toBe('2026-04-19')
    expect(weekdayFr(p1.startsOn)).toBe('samedi')
    expect(weekdayFr(p1.endsOn)).toBe('dimanche')
  })

  it('tiennent debout : la fin ne précède jamais le début', () => {
    for (const p of NC_CALENDAR_2026) {
      expect(p.endsOn >= p.startsOn, `${p.label} : ${p.startsOn} → ${p.endsOn}`).toBe(true)
    }
  })
})

describe("L'import est rejouable", () => {
  it('ne propose que ce qui manque', () => {
    const dejaLa = [
      { kind: 'ferie' as const, startsOn: '2026-12-25', endsOn: '2026-12-25' },
      { kind: 'scolaire' as const, startsOn: '2026-04-04', endsOn: '2026-04-19' },
    ]
    const manquant = missingFrom(dejaLa)

    expect(manquant).toHaveLength(NC_CALENDAR_2026.length - 2)
    expect(manquant.some((s) => s.label === 'Noël')).toBe(false)
    expect(manquant.some((s) => s.label === 'Fête locale')).toBe(true)
  })

  it('ne recrée rien quand tout est déjà là', () => {
    expect(missingFrom(NC_CALENDAR_2026)).toHaveLength(0)
  })

  it('reconnaît une période aux DATES, pas au libellé', () => {
    // « Noël » saisi à la main sous le nom « Noël 2026 » reste le même jour :
    // l'import ne doit pas le doubler.
    const renomme = [{ kind: 'ferie' as const, startsOn: '2026-12-25', endsOn: '2026-12-25' }]
    expect(missingFrom(renomme).some((s) => s.startsOn === '2026-12-25')).toBe(false)
  })
})
