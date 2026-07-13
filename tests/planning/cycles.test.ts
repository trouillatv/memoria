// PL4 — le ROULEMENT, prouvé à sec.
//
// Ce que ces tests verrouillent :
//  • un rythme SANS cycle se comporte EXACTEMENT comme avant (no-op) — c'est ce
//    qui garde l'oracle de PL1 vert ;
//  • une alternance A/B tombe une semaine sur deux, jamais toutes les semaines ;
//  • l'ANCRAGE est le point fixe : c'est lui qui décide quelle semaine est la A ;
//  • décaler la rotation = décaler l'ancrage d'une semaine. UN champ.
//  • les cycles de 3 et 4 semaines tournent juste, sur des mois.

import { describe, it, expect } from 'vitest'
import {
  projectOccurrences,
  matchesFrequency,
  cycleWeekIndex,
  type ProjectableTemplate,
} from '@/lib/planning/projection'

const base: Omit<ProjectableTemplate, 'id' | 'frequency'> = {
  mission_id: 'm1',
  slots: null,
  day_of_week: null,
  day_of_month: null,
  planned_start_hhmm: '06:00',
  planned_end_hhmm: '09:00',
  starts_on: '2026-07-01',
  ends_on: null,
}

/** Un rythme de roulement : « le lundi de la semaine A ». */
const cyclic = (p: Partial<ProjectableTemplate>): ProjectableTemplate =>
  ({
    ...base,
    id: 't-cycle',
    frequency: 'weekly',
    day_of_week: 1, // lundi
    cycle_length_weeks: 2,
    anchor_date: '2026-07-06', // lundi = semaine A
    week_index: 0,
    ...p,
  }) as ProjectableTemplate

const dates = (tpls: ProjectableTemplate[], from: string, to: string) =>
  projectOccurrences({ templates: tpls, from, to }).map((o) => o.scheduledFor)

describe('cycleWeekIndex — l’ancrage est le point fixe', () => {
  const A = '2026-07-06' // lundi

  it('la semaine de l’ancrage est la semaine A (index 0)', () => {
    expect(cycleWeekIndex(A, '2026-07-06', 2)).toBe(0)
    expect(cycleWeekIndex(A, '2026-07-12', 2)).toBe(0) // dimanche de la même semaine
  })

  it('la semaine suivante est la B (index 1)', () => {
    expect(cycleWeekIndex(A, '2026-07-13', 2)).toBe(1)
  })

  it('puis on revient en A — c’est un cycle', () => {
    expect(cycleWeekIndex(A, '2026-07-20', 2)).toBe(0)
    expect(cycleWeekIndex(A, '2026-07-27', 2)).toBe(1)
  })

  it('avant l’ancrage, l’index reste POSITIF (jamais un modulo négatif)', () => {
    expect(cycleWeekIndex(A, '2026-06-29', 2)).toBe(1)
    expect(cycleWeekIndex(A, '2026-06-22', 2)).toBe(0)
  })

  it('cycles de 3 et 4 semaines : la rotation est juste', () => {
    // Les 5 lundis qui suivent l'ancrage (le calendrier passe d'un mois à l'autre).
    const lundis = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03']
    expect(lundis.map((d) => cycleWeekIndex(A, d, 3))).toEqual([0, 1, 2, 0, 1])
    expect(lundis.map((d) => cycleWeekIndex(A, d, 4))).toEqual([0, 1, 2, 3, 0])
    expect(lundis.map((d) => cycleWeekIndex(A, d, 1))).toEqual([0, 0, 0, 0, 0]) // cycle d'1 semaine
  })
})

describe('PL4 — le rythme SANS cycle ne change PAS (no-op)', () => {
  it('les trois champs absents → comportement d’avant, à la ligne près', () => {
    const legacy = { ...base, id: 't', frequency: 'weekly', day_of_week: 1 } as ProjectableTemplate
    // Tous les lundis de juillet, sans exception.
    expect(dates([legacy], '2026-07-01', '2026-07-31')).toEqual([
      '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27',
    ])
  })

  it('un cycle INCOMPLET (ancrage manquant) est ignoré — pas de demi-cycle', () => {
    const bancal = cyclic({ anchor_date: null })
    expect(dates([bancal], '2026-07-01', '2026-07-31')).toHaveLength(4) // tous les lundis
  })

  it('week_index à 0 est bien pris en compte (le piège du falsy)', () => {
    const semA = cyclic({ week_index: 0 })
    expect(dates([semA], '2026-07-01', '2026-07-31')).toEqual(['2026-07-06', '2026-07-20'])
  })
})

describe('PL4 — l’alternance A/B de Guillaume', () => {
  const semaineA = cyclic({ id: 't-A', week_index: 0 })
  const semaineB = cyclic({ id: 't-B', week_index: 1 })

  it('la semaine A tombe UNE SEMAINE SUR DEUX', () => {
    expect(dates([semaineA], '2026-07-01', '2026-08-31')).toEqual([
      '2026-07-06', '2026-07-20', '2026-08-03', '2026-08-17', '2026-08-31',
    ])
  })

  it('la semaine B tombe sur les lundis de l’AUTRE semaine', () => {
    expect(dates([semaineB], '2026-07-01', '2026-08-31')).toEqual([
      '2026-07-13', '2026-07-27', '2026-08-10', '2026-08-24',
    ])
  })

  it('A et B ensemble reconstituent TOUS les lundis — et jamais deux fois le même', () => {
    const tous = dates([semaineA, semaineB], '2026-07-01', '2026-08-31').sort()
    expect(new Set(tous).size).toBe(tous.length) // aucun doublon
    expect(tous).toEqual([
      '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27',
      '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31',
    ])
  })

  it('DÉCALER LA ROTATION = décaler l’ancrage d’une semaine. UN champ.', () => {
    const decale = cyclic({ id: 't-A', week_index: 0, anchor_date: '2026-07-13' })
    // Ce qui était la semaine A devient la B, et réciproquement.
    expect(dates([decale], '2026-07-01', '2026-08-31')).toEqual([
      '2026-07-13', '2026-07-27', '2026-08-10', '2026-08-24',
    ])
  })
})

describe('PL4 — le roulement s’arrête quand il doit', () => {
  it('ends_on borne le cycle (« jusqu’au 31 juillet »)', () => {
    const borne = cyclic({ ends_on: '2026-07-31' })
    expect(dates([borne], '2026-07-01', '2026-09-30')).toEqual(['2026-07-06', '2026-07-20'])
  })

  it('starts_on ne fait pas démarrer avant l’heure', () => {
    const tardif = cyclic({ starts_on: '2026-07-15' })
    expect(dates([tardif], '2026-07-01', '2026-08-31')).toEqual([
      '2026-07-20', '2026-08-03', '2026-08-17', '2026-08-31',
    ])
  })
})

describe('PL4 — une semaine type complète (3 équipes, cycle de 2)', () => {
  // Marie-Thérèse travaille lundi (A) et mardi (B) ; Giselle mardi (A).
  const grille: ProjectableTemplate[] = [
    cyclic({ id: 'mt-lun-A', day_of_week: 1, week_index: 0 }),
    cyclic({ id: 'mt-mar-B', day_of_week: 2, week_index: 1 }),
    cyclic({ id: 'gi-mar-A', day_of_week: 2, week_index: 0 }),
  ]

  it('chaque case tombe exactement où elle doit', () => {
    const occ = projectOccurrences({ templates: grille, from: '2026-07-06', to: '2026-07-19' })
    const parRythme = occ.reduce<Record<string, string[]>>((acc, o) => {
      ;(acc[o.templateId] ??= []).push(o.scheduledFor)
      return acc
    }, {})
    expect(parRythme['mt-lun-A']).toEqual(['2026-07-06'])  // lundi semaine A
    expect(parRythme['gi-mar-A']).toEqual(['2026-07-07'])  // mardi semaine A
    expect(parRythme['mt-mar-B']).toEqual(['2026-07-14'])  // mardi semaine B
  })

  it('les occurrences gardent leur heure', () => {
    const occ = projectOccurrences({ templates: grille, from: '2026-07-06', to: '2026-07-06' })
    expect(occ[0].plannedStart).toBe('2026-07-06T06:00:00.000Z')
    expect(occ[0].plannedEnd).toBe('2026-07-06T09:00:00.000Z')
  })
})

describe('PL4 — matchesFrequency reste juste', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it('une date de la mauvaise semaine est refusée AVANT même de regarder le jour', () => {
    const semA = cyclic({ week_index: 0 })
    expect(matchesFrequency(semA, d('2026-07-06'))).toBe(true)  // lundi, semaine A
    expect(matchesFrequency(semA, d('2026-07-13'))).toBe(false) // lundi, semaine B
  })

  it('un rythme « du lundi au vendredi » peut aussi être cyclique', () => {
    const semaineTravaillee = cyclic({ frequency: 'weekdays', day_of_week: null, week_index: 0 })
    expect(dates([semaineTravaillee], '2026-07-06', '2026-07-19')).toEqual([
      '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
    ]) // la semaine B est muette
  })
})
