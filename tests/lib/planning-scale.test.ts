import { describe, it, expect } from 'vitest'
import {
  enumerateRangeDays,
  weekdayShortFr,
  dayNumber,
  isWeekend,
  columnWidthClass,
} from '@/lib/planning/scale'

/**
 * LE PLANNING EST UN ESPACE, PAS TROIS ÉCRANS.
 *
 * Deux verrous clouaient la grille à la semaine :
 *
 *   1. l'énumération des jours ignorait la borne de fin et comptait SEPT jours
 *      à partir du lundi ;
 *   2. le libellé du jour était indexé par POSITION (`DAY_LABELS_SHORT[i]`) —
 *      à trente-et-une colonnes, le 8 du mois se serait appelé « Lun ».
 *
 * Ces tests tiennent les deux : la plage décide, et le jour se déduit de la date.
 * Sans ça, le mois exigerait une seconde grille — et deux tableaux parallèles
 * finissent toujours par diverger.
 */

describe('Les jours de la plage', () => {
  it('en compte SEPT pour une semaine — la semaine ne change pas', () => {
    const days = enumerateRangeDays({ start: '2026-07-13', end: '2026-07-19' })
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-07-13')
    expect(days[6]).toBe('2026-07-19')
  })

  it('en compte TRENTE-ET-UN pour juillet — le même code, sans rien réécrire', () => {
    const days = enumerateRangeDays({ start: '2026-07-01', end: '2026-07-31' })
    expect(days).toHaveLength(31)
    expect(days[30]).toBe('2026-07-31')
  })

  it('gère un mois de 28 jours, et le passage de mois', () => {
    expect(enumerateRangeDays({ start: '2026-02-01', end: '2026-02-28' })).toHaveLength(28)
    expect(enumerateRangeDays({ start: '2026-01-30', end: '2026-02-02' })).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ])
  })

  it('en compte UN pour le jour', () => {
    expect(enumerateRangeDays({ start: '2026-07-14', end: '2026-07-14' })).toEqual(['2026-07-14'])
  })

  it('ne rend rien plutôt que de boucler sur une plage inversée', () => {
    expect(enumerateRangeDays({ start: '2026-07-19', end: '2026-07-13' })).toEqual([])
  })
})

describe('Le libellé du jour', () => {
  it('se déduit de la DATE, jamais de la position dans la grille', () => {
    // 2026-07-13 est un lundi. 2026-07-19, un dimanche.
    expect(weekdayShortFr('2026-07-13')).toBe('Lun')
    expect(weekdayShortFr('2026-07-19')).toBe('Dim')
  })

  it('reste juste au milieu d’un mois — là où l’index cassait', () => {
    // 8ᵉ colonne d'une vue Mois : l'ancien code aurait dit « Lun » (index 0
    // après un tour). C'est un mercredi.
    expect(weekdayShortFr('2026-07-08')).toBe('Mer')
  })

  it('donne le quantième', () => {
    expect(dayNumber('2026-07-14')).toBe(14)
  })

  it('distingue le week-end — un mois en compte huit ou neuf', () => {
    expect(isWeekend('2026-07-18')).toBe(true) // samedi
    expect(isWeekend('2026-07-19')).toBe(true) // dimanche
    expect(isWeekend('2026-07-17')).toBe(false) // vendredi
  })
})

describe("L'échelle", () => {
  it('ne change QUE la densité — jamais le modèle', () => {
    // Trente-et-une colonnes ne tiennent pas à la largeur d'une semaine.
    expect(columnWidthClass('month')).not.toBe(columnWidthClass('week'))
    expect(columnWidthClass('day')).not.toBe(columnWidthClass('week'))
  })

  it('laisse la semaine exactement où elle était', () => {
    expect(columnWidthClass('week')).toBe('min-w-[7rem]')
  })
})
