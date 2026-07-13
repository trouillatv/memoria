// La DATE D'EFFET — la question qu'on pose toujours, jamais devinée.
//
// Ce qu'on protège :
//   • l'ancienne version s'arrête LA VEILLE : aucun jour couvert deux fois,
//     aucun jour orphelin ;
//   • « lundi prochain » ne désigne JAMAIS aujourd'hui, même un lundi ;
//   • une date d'effet passée est refusée — le passé ne se re-décide pas ;
//   • une date d'effet avant le premier jour du roulement n'est pas une
//     version : c'est une réécriture qui ne dit pas son nom.

import { describe, it, expect } from 'vitest'
import {
  resolveEffectiveDate,
  nextMondayIso,
  previousDayIso,
  splitAt,
  isRealSplit,
} from '@/lib/planning/cycle-effect'

// Le mardi 14 juillet 2026.
const MARDI = '2026-07-14'

describe('Les quatre intentions', () => {
  it('« je me suis trompé » → pas de date : on corrige sur place', () => {
    expect(resolveEffectiveDate('rewrite', null, MARDI)).toEqual({ date: null })
  })

  it('« immédiatement » → aujourd’hui', () => {
    expect(resolveEffectiveDate('immediate', null, MARDI)).toEqual({ date: MARDI })
  })

  it('« lundi prochain » → le 20 juillet', () => {
    expect(resolveEffectiveDate('next_monday', null, MARDI)).toEqual({ date: '2026-07-20' })
  })

  it('« à partir du 1er septembre » → la rentrée se prépare', () => {
    expect(resolveEffectiveDate('date', '2026-09-01', MARDI)).toEqual({ date: '2026-09-01' })
  })
})

describe('Lundi prochain — jamais aujourd’hui', () => {
  it('un lundi, « lundi prochain » dit la semaine d’après', () => {
    // Dire « à partir de lundi prochain » un lundi matin ne parle jamais du
    // jour même : appliquer un changement au jour où on le formule serait
    // « immédiatement », et ce geste existe déjà.
    expect(nextMondayIso('2026-07-13')).toBe('2026-07-20') // lundi → lundi suivant
  })

  it('un dimanche, c’est demain', () => {
    expect(nextMondayIso('2026-07-19')).toBe('2026-07-20')
  })
})

describe('Le passé ne se re-décide pas', () => {
  it('une date d’effet d’hier est refusée, avec un motif', () => {
    expect(resolveEffectiveDate('date', '2026-07-10', MARDI)).toEqual({
      error: 'La date d’effet est déjà passée',
    })
  })

  it('une date manquante ou difforme est refusée', () => {
    expect(resolveEffectiveDate('date', null, MARDI)).toEqual({
      error: 'Choisissez la date d’effet',
    })
    expect(resolveEffectiveDate('date', 'septembre', MARDI)).toEqual({
      error: 'Choisissez la date d’effet',
    })
  })

  it('aujourd’hui est une date d’effet valide', () => {
    expect(resolveEffectiveDate('date', MARDI, MARDI)).toEqual({ date: MARDI })
  })
})

describe('La coupure entre deux versions', () => {
  it('l’ancienne version s’arrête LA VEILLE — aucun jour orphelin, aucun jour double', () => {
    expect(splitAt('2026-09-01')).toEqual({ oldEndsOn: '2026-08-31' })
    expect(previousDayIso('2026-01-01')).toBe('2025-12-31') // l'année ne casse rien
  })

  it('une date d’effet AVANT le premier jour n’est pas une version', () => {
    // Il n'y aurait rien à découper : c'est une réécriture qui ne dit pas son
    // nom — et elle doit être traitée comme telle, pas déguisée en historique.
    expect(isRealSplit('2026-06-01', '2026-07-01')).toBe(false)
    expect(isRealSplit('2026-07-01', '2026-07-01')).toBe(false) // le jour même non plus
    expect(isRealSplit('2026-09-01', '2026-07-01')).toBe(true)
  })
})
