// Le matin de Guillaume, prouvé à sec.
//
// Ce qu'on protège ici :
//   • un CONFLIT est rouge — c'est un fait déclaré (quelqu'un a écrit « fermé »,
//     quelqu'un a planifié). Il appelle une décision.
//   • une FERMETURE seule n'est PAS une alerte. Un magasin fermé n'appelle
//     aucune action : elle se dit, elle ne crie pas.
//   • un DÉBRIEF en attente est orange — la visite est finie, les captures
//     dorment. Aucune inférence sur qui aurait dû le faire.

import { describe, it, expect } from 'vitest'
import {
  buildConflictItems,
  buildDebriefItems,
  buildClosedToday,
  type PendingDebrief,
} from '@/lib/attention/digest-items'
import type { ProjectableClosure } from '@/lib/planning/closures'
import type { ClosureConflict } from '@/lib/planning/conflicts'

const NAMES = new Map([
  ['s1', 'Discount Poindimié'],
  ['s2', 'Mairie de Koné'],
])

const closure = (over: Partial<ProjectableClosure> = {}): ProjectableClosure => ({
  id: 'c1',
  siteId: 's1',
  reasonKind: 'holiday',
  reason: null,
  startsOn: '2026-07-14',
  endsOn: '2026-07-14',
  defaultResolution: 'none',
  ...over,
})

const conflict = (expectedCount: number, c = closure()): ClosureConflict => ({
  closure: c,
  expectedCount,
})

describe('CONFLITS — rouge, parce que c’est un fait déclaré', () => {
  it('dit combien de prestations, où, et pourquoi', () => {
    const [item] = buildConflictItems(
      { s1: { '2026-07-14': conflict(2, closure({ reason: 'Magasin fermé' })) } },
      NAMES,
    )
    expect(item.tier).toBe('red')
    expect(item.what).toBe('2 prestations prévues un jour de fermeture')
    expect(item.where).toBe('Discount Poindimié')
    expect(item.why).toBe('le 14 juillet — magasin fermé')
    expect(item.href).toBe('/semaine')
  })

  it('un seul item par chantier, même sur plusieurs jours — on ne noie pas le matin', () => {
    const items = buildConflictItems(
      {
        s1: {
          '2026-07-14': conflict(1),
          '2026-07-15': conflict(2),
        },
      },
      NAMES,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toBe('3 prestations prévues un jour de fermeture')
    expect(items[0].why).toBe('2 jours concernés, à partir du 14 juillet')
  })

  it('sans motif écrit, on retombe sur le motif type', () => {
    const [item] = buildConflictItems({ s1: { '2026-07-14': conflict(1) } }, NAMES)
    expect(item.why).toContain('jour férié')
  })

  it('une fermeture sans personne prévue ne produit AUCUN conflit', () => {
    expect(buildConflictItems({ s1: { '2026-07-14': conflict(0) } }, NAMES)).toEqual([])
    expect(buildConflictItems({}, NAMES)).toEqual([])
  })
})

describe('FERMETURES — dites, jamais alarmées', () => {
  it('un chantier fermé aujourd’hui est nommé, avec son motif', () => {
    const closed = buildClosedToday({ s1: [closure({ reason: 'Inventaire' })] }, NAMES, '2026-07-14')
    expect(closed).toEqual([{ siteId: 's1', siteName: 'Discount Poindimié', reason: 'Inventaire' }])
  })

  it('une fermeture qui ne couvre pas aujourd’hui ne dit rien', () => {
    const closed = buildClosedToday(
      { s1: [closure({ startsOn: '2026-07-20', endsOn: '2026-07-21' })] },
      NAMES,
      '2026-07-14',
    )
    expect(closed).toEqual([])
  })

  it('sans motif écrit, le motif type suffit', () => {
    const [c] = buildClosedToday({ s1: [closure({ reason: '  ' })] }, NAMES, '2026-07-14')
    expect(c.reason).toBe('Jour férié')
  })

  it('plusieurs chantiers fermés sont listés dans l’ordre alphabétique', () => {
    const closed = buildClosedToday(
      { s1: [closure()], s2: [closure({ siteId: 's2' })] },
      NAMES,
      '2026-07-14',
    )
    expect(closed.map((c) => c.siteName)).toEqual(['Discount Poindimié', 'Mairie de Koné'])
  })
})

describe('DÉBRIEFS EN ATTENTE — la visite est finie, les captures dorment', () => {
  const visite = (over: Partial<PendingDebrief> = {}): PendingDebrief => ({
    reportId: 'r1',
    siteId: 's1',
    remaining: 3,
    endedAt: '2026-07-10T18:00:00.000Z',
    ...over,
  })

  it('dit depuis quand, et combien d’éléments attendent', () => {
    const [item] = buildDebriefItems([visite()], NAMES, '2026-07-14')
    expect(item.tier).toBe('orange')
    expect(item.what).toBe('1 visite à débriefer')
    expect(item.where).toBe('Discount Poindimié')
    expect(item.why).toBe('la plus ancienne date d’il y a 4 j — 3 éléments en attente')
    expect(item.href).toBe('/sites/s1/visites/r1')
  })

  it('regroupe par chantier et pointe la plus ancienne', () => {
    const items = buildDebriefItems(
      [
        visite({ reportId: 'recent', endedAt: '2026-07-13T18:00:00.000Z', remaining: 1 }),
        visite({ reportId: 'ancienne', endedAt: '2026-07-09T18:00:00.000Z', remaining: 2 }),
      ],
      NAMES,
      '2026-07-14',
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toBe('2 visites à débriefer')
    expect(items[0].href).toBe('/sites/s1/visites/ancienne')
    expect(items[0].why).toContain('3 éléments')
  })

  it('une visite du jour se dit sans compter les jours', () => {
    const [item] = buildDebriefItems(
      [visite({ endedAt: '2026-07-14T06:00:00.000Z', remaining: 1 })],
      NAMES,
      '2026-07-14',
    )
    expect(item.why).toBe('1 élément rapporté aujourd’hui, pas encore trié')
  })

  it('une visite déjà triée ne remonte pas', () => {
    expect(buildDebriefItems([visite({ remaining: 0 })], NAMES, '2026-07-14')).toEqual([])
  })
})
