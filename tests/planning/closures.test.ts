// PL2 — les fermetures de site, prouvées à sec.
//
// Ce que ces tests verrouillent :
//  • les bornes sont INCLUSES (le premier et le dernier jour sont fermés) ;
//  • deux fermetures qui se suivent ne laissent AUCUN trou ;
//  • deux fermetures qui se chevauchent donnent un résultat DÉTERMINISTE
//    (règle fixée : commencée le plus tôt → la plus contraignante → id) ;
//  • on renvoie LA FERMETURE (pourquoi), jamais un booléen — PL3 en a besoin.

import { describe, it, expect } from 'vitest'
import {
  findClosureForDate,
  projectClosures,
  CLOSURE_REASON_FR,
  type ProjectableClosure,
} from '@/lib/planning/closures'

const SITE = 'site-discount-pointiere'

const closure = (p: Partial<ProjectableClosure> & { id: string; startsOn: string; endsOn: string }): ProjectableClosure => ({
  siteId: SITE,
  reasonKind: 'other',
  reason: null,
  defaultResolution: 'none',
  ...p,
})

describe('findClosureForDate — bornes', () => {
  const ferie = closure({ id: 'c1', startsOn: '2026-07-14', endsOn: '2026-07-14', reasonKind: 'holiday', reason: 'Magasin fermé' })

  it('une fermeture d’un jour ferme CE jour', () => {
    expect(findClosureForDate([ferie], '2026-07-14')?.id).toBe('c1')
  })

  it('la veille et le lendemain restent ouverts', () => {
    expect(findClosureForDate([ferie], '2026-07-13')).toBeNull()
    expect(findClosureForDate([ferie], '2026-07-15')).toBeNull()
  })

  it('bornes INCLUSES sur une période', () => {
    const annuelle = closure({ id: 'c2', startsOn: '2026-12-24', endsOn: '2027-01-02', reasonKind: 'client' })
    expect(findClosureForDate([annuelle], '2026-12-24')?.id).toBe('c2') // premier jour
    expect(findClosureForDate([annuelle], '2026-12-31')?.id).toBe('c2') // milieu, changement d'année
    expect(findClosureForDate([annuelle], '2027-01-02')?.id).toBe('c2') // dernier jour
    expect(findClosureForDate([annuelle], '2027-01-03')).toBeNull()     // lendemain
  })

  it('renvoie LA fermeture — le pourquoi, pas un oui/non', () => {
    const c = findClosureForDate([ferie], '2026-07-14')
    expect(c?.reasonKind).toBe('holiday')
    expect(c?.reason).toBe('Magasin fermé')
    expect(CLOSURE_REASON_FR[c!.reasonKind]).toBe('Jour férié')
  })

  it('aucune fermeture → null (l’ouverture est l’état normal)', () => {
    expect(findClosureForDate([], '2026-07-14')).toBeNull()
  })
})

describe('fermetures qui SE SUIVENT — aucun trou', () => {
  // Trois fermetures d'un jour, dos à dos : 14, 15, 16.
  const suite = [
    closure({ id: 'a', startsOn: '2026-07-14', endsOn: '2026-07-14' }),
    closure({ id: 'b', startsOn: '2026-07-15', endsOn: '2026-07-15' }),
    closure({ id: 'c', startsOn: '2026-07-16', endsOn: '2026-07-16' }),
  ]

  it('les trois jours sont fermés, chacun par SA fermeture', () => {
    expect(findClosureForDate(suite, '2026-07-14')?.id).toBe('a')
    expect(findClosureForDate(suite, '2026-07-15')?.id).toBe('b')
    expect(findClosureForDate(suite, '2026-07-16')?.id).toBe('c')
  })

  it('la projection ne laisse aucun trou entre le 14 et le 16', () => {
    const days = projectClosures({ closures: suite, from: '2026-07-13', to: '2026-07-17' })
    expect(Object.keys(days).sort()).toEqual(['2026-07-14', '2026-07-15', '2026-07-16'])
    expect(days['2026-07-13']).toBeUndefined() // ouvert
    expect(days['2026-07-17']).toBeUndefined() // ouvert
  })

  it('deux périodes contiguës (10→14, 15→20) couvrent 10 à 20 sans discontinuité', () => {
    const contigues = [
      closure({ id: 'p1', startsOn: '2026-07-10', endsOn: '2026-07-14' }),
      closure({ id: 'p2', startsOn: '2026-07-15', endsOn: '2026-07-20' }),
    ]
    const days = projectClosures({ closures: contigues, from: '2026-07-10', to: '2026-07-20' })
    expect(Object.keys(days)).toHaveLength(11) // 10..20 inclus
    expect(days['2026-07-14'].id).toBe('p1')
    expect(days['2026-07-15'].id).toBe('p2')
  })
})

describe('fermetures qui SE CHEVAUCHENT — comportement fixé', () => {
  // Règle : commencée le plus tôt → la plus contraignante (fin la plus tardive)
  //         → le plus petit id. Toujours déterministe.
  const a = closure({ id: 'aaa', startsOn: '2026-07-10', endsOn: '2026-07-20', reasonKind: 'client' })
  const b = closure({ id: 'bbb', startsOn: '2026-07-15', endsOn: '2026-07-30', reasonKind: 'maintenance' })

  it('sur le chevauchement, c’est la fermeture DÉJÀ EN VIGUEUR qui s’applique', () => {
    expect(findClosureForDate([a, b], '2026-07-16')?.id).toBe('aaa')
  })

  it('l’ordre d’arrivée ne change RIEN (pas « celle que la base a renvoyée en premier »)', () => {
    expect(findClosureForDate([a, b], '2026-07-16')?.id).toBe(findClosureForDate([b, a], '2026-07-16')?.id)
  })

  it('après la fin de la première, la seconde prend le relais', () => {
    expect(findClosureForDate([a, b], '2026-07-21')?.id).toBe('bbb')
  })

  it('à date de début égale, la plus CONTRAIGNANTE gagne (celle qui finit le plus tard)', () => {
    const courte = closure({ id: 'x1', startsOn: '2026-07-10', endsOn: '2026-07-12' })
    const longue = closure({ id: 'x2', startsOn: '2026-07-10', endsOn: '2026-07-20' })
    expect(findClosureForDate([courte, longue], '2026-07-11')?.id).toBe('x2')
    expect(findClosureForDate([longue, courte], '2026-07-11')?.id).toBe('x2')
  })

  it('à période strictement identique, l’id départage (résultat total, donc stable)', () => {
    const un = closure({ id: 'aaa', startsOn: '2026-07-10', endsOn: '2026-07-12' })
    const deux = closure({ id: 'bbb', startsOn: '2026-07-10', endsOn: '2026-07-12' })
    expect(findClosureForDate([deux, un], '2026-07-11')?.id).toBe('aaa')
  })
})

describe('projectClosures — le pendant de projectOccurrences (PL1)', () => {
  const c = closure({ id: 'c1', startsOn: '2026-07-14', endsOn: '2026-07-14', reasonKind: 'holiday' })

  it('un jour ouvert n’a PAS de clé (l’absence est l’état normal)', () => {
    const days = projectClosures({ closures: [c], from: '2026-07-13', to: '2026-07-15' })
    expect(Object.keys(days)).toEqual(['2026-07-14'])
  })

  it('période inversée → aucun jour', () => {
    expect(projectClosures({ closures: [c], from: '2026-07-20', to: '2026-07-01' })).toEqual({})
  })

  it('fenêtre invalide → aucun jour (jamais d’Invalid Date)', () => {
    expect(projectClosures({ closures: [c], from: 'demain', to: '2026-07-31' })).toEqual({})
  })

  it('un mois entier : seuls les jours réellement fermés sortent', () => {
    const noel = closure({ id: 'noel', startsOn: '2026-12-24', endsOn: '2027-01-02', reasonKind: 'client' })
    const days = projectClosures({ closures: [noel], from: '2026-12-01', to: '2026-12-31' })
    expect(Object.keys(days)).toHaveLength(8) // 24 → 31 décembre
    expect(days['2026-12-23']).toBeUndefined()
    expect(days['2026-12-24'].reasonKind).toBe('client')
  })

  it('déterministe : deux appels identiques donnent le même résultat', () => {
    const args = { closures: [c], from: '2026-07-01', to: '2026-07-31' }
    expect(projectClosures(args)).toEqual(projectClosures(args))
  })
})
