// PL3b — résoudre le conflit « site fermé, prestation prévue ».
//
// Ce qu'on protège, et qui compte plus que le reste :
//
//   ⚖️ ON NE PROPOSE JAMAIS UNE DATE FERMÉE. Remplacer un conflit par un autre
//      serait pire que de ne rien proposer : Guillaume ferait confiance au geste,
//      et se retrouverait devant un rideau baissé.
//
//   ⚖️ MEMORIA NE DÉCIDE PAS. Il propose ; l'humain tranche ; on trace.
//
//   ⚖️ LE WEEK-END N'EST PAS UNE FERMETURE. Guillaume travaille le samedi et le
//      dimanche — sa feuille de juillet le prouve. Seule une fermeture DÉCLARÉE
//      ferme un jour.

import { describe, it, expect } from 'vitest'
import {
  nextOpenDay,
  resolutionOptions,
  validateChosenDate,
  isClosed,
  gapFr,
  DECISION_FR,
} from '@/lib/planning/conflict-resolution'
import type { ProjectableClosure } from '@/lib/planning/closures'

const closure = (startsOn: string, endsOn: string, reason: string | null = null): ProjectableClosure => ({
  id: `c-${startsOn}`,
  siteId: 's1',
  reasonKind: 'holiday',
  reason,
  startsOn,
  endsOn,
  defaultResolution: 'none',
})

// Le mercredi 15 juillet 2026 est fermé.
const FERME_LE_15 = [closure('2026-07-15', '2026-07-15')]

describe('On ne propose JAMAIS une date fermée', () => {
  it('la veille et le lendemain, quand ils sont ouverts', () => {
    const opts = resolutionOptions(FERME_LE_15, '2026-07-15')
    expect(opts).toEqual([
      { kind: 'move_before', date: '2026-07-14', gapDays: 1 },
      { kind: 'move_after', date: '2026-07-16', gapDays: 1 },
    ])
  })

  it('une fermeture de plusieurs jours : on saute PAR-DESSUS', () => {
    // Fermé du 14 au 17 : la veille ouverte est le 13, le lendemain ouvert le 18.
    const opts = resolutionOptions([closure('2026-07-14', '2026-07-17')], '2026-07-15')
    expect(opts.map((o) => o.date)).toEqual(['2026-07-13', '2026-07-18'])
    expect(opts.map((o) => o.gapDays)).toEqual([2, 3])
  })

  it('deux fermetures qui se suivent : on les saute toutes les deux', () => {
    const opts = resolutionOptions(
      [closure('2026-07-15', '2026-07-15'), closure('2026-07-16', '2026-07-16')],
      '2026-07-15',
    )
    expect(opts.find((o) => o.kind === 'move_after')?.date).toBe('2026-07-17')
  })

  it('une fermeture LONGUE ne propose RIEN — elle ne se règle pas par un déplacement', () => {
    // Trois semaines de fermeture : aucun jour ouvert à ±14 jours après.
    const longue = [closure('2026-07-15', '2026-08-10')]
    const opts = resolutionOptions(longue, '2026-07-20')
    // Avant reste possible (le 14) ; après, non.
    expect(opts.find((o) => o.kind === 'move_after')).toBeUndefined()
  })

  it('un bouton impossible n’est jamais affiché : la liste est vide, pas fausse', () => {
    // Tout est fermé autour : aucune proposition.
    const tout = [closure('2026-06-01', '2026-09-01')]
    expect(resolutionOptions(tout, '2026-07-15')).toEqual([])
  })
})

describe('Le WEEK-END n’est pas une fermeture', () => {
  it('le samedi et le dimanche sont des jours ouverts — sa feuille les travaille', () => {
    // Vendredi 17 juillet 2026 fermé → le lendemain ouvert est le SAMEDI 18.
    const opts = resolutionOptions([closure('2026-07-17', '2026-07-17')], '2026-07-17')
    expect(opts.find((o) => o.kind === 'move_after')?.date).toBe('2026-07-18') // samedi
  })
})

describe('nextOpenDay — le premier jour ouvert', () => {
  it('renvoie null quand rien n’est ouvert dans la fenêtre', () => {
    expect(nextOpenDay([closure('2026-07-01', '2026-12-31')], '2026-07-15', 1)).toBeNull()
  })

  it('ne rend jamais le jour du conflit lui-même', () => {
    const d = nextOpenDay(FERME_LE_15, '2026-07-15', 1)
    expect(d).not.toBe('2026-07-15')
  })

  it('isClosed dit la vérité', () => {
    expect(isClosed(FERME_LE_15, '2026-07-15')).toBe(true)
    expect(isClosed(FERME_LE_15, '2026-07-16')).toBe(false)
  })
})

describe('Une date choisie à la main est VÉRIFIÉE — et le refus est DIT', () => {
  it('une date ouverte passe', () => {
    expect(validateChosenDate(FERME_LE_15, '2026-07-20', '2026-07-14')).toEqual({ ok: true })
  })

  it('une date FERMÉE est refusée avec son motif — on ne remplace pas un conflit par un autre', () => {
    const r = validateChosenDate(
      [closure('2026-07-20', '2026-07-20', 'Inventaire')],
      '2026-07-20',
      '2026-07-14',
    )
    expect(r).toEqual({ ok: false, reason: 'Le chantier est aussi fermé ce jour-là — Inventaire' })
  })

  it('le PASSÉ est refusé — on ne replanifie pas hier', () => {
    const r = validateChosenDate([], '2026-07-10', '2026-07-14')
    expect(r).toEqual({ ok: false, reason: 'Cette date est déjà passée' })
  })

  it('une date qui n’est pas une date est refusée', () => {
    expect(validateChosenDate([], 'demain', '2026-07-14').ok).toBe(false)
  })
})

describe('Ça se dit en français, jamais en jargon', () => {
  it('« la veille », « le lendemain »', () => {
    expect(gapFr(1, 'before')).toBe('la veille')
    expect(gapFr(1, 'after')).toBe('le lendemain')
  })

  it('« 3 jours avant », « 2 jours après » — jamais « J-3 »', () => {
    expect(gapFr(3, 'before')).toBe('3 jours avant')
    expect(gapFr(2, 'after')).toBe('2 jours après')
  })

  it('chaque décision se relit un an plus tard', () => {
    expect(DECISION_FR.moved).toBe('Déplacée')
    expect(DECISION_FR.kept).toBe('Maintenue malgré la fermeture')
    expect(DECISION_FR.cancelled).toBe('Annulée')
  })
})
