// L'exception ponctuelle — « ce jour-là, on déroge ». Prouvée à sec.
//
// Ce qu'on protège :
//   • une occurrence CONFORME ne signale RIEN — crier sur ce qui va bien, c'est
//     apprendre à ignorer les signaux ;
//   • chaque déviation est un FAIT comparable (jour, équipe, horaire, annulée) ;
//   • « revenir » vise le jour que le rythme PRESCRIT, jamais un souvenir ;
//   • au-delà d'une semaine, on ne devine pas — on le dit.

import { describe, it, expect } from 'vitest'
import {
  detectDeviations,
  prescribedDateNear,
  hhmmOf,
  type OccurrenceView,
} from '@/lib/planning/occurrence-exception'
import type { ProjectableTemplate } from '@/lib/planning/projection'

// Un rythme hebdomadaire : tous les MARDIS (2026-07-14 en est un), 06:00–09:00,
// équipe Nord.
const TPL = {
  id: 'tpl-1',
  mission_id: 'm1',
  frequency: 'weekly' as const,
  slots: null,
  day_of_week: 2,
  day_of_month: null,
  planned_start_hhmm: '06:00',
  planned_end_hhmm: '09:00',
  starts_on: '2026-01-01',
  ends_on: null,
  assigned_team_id: 'team-nord',
} as ProjectableTemplate & { assigned_team_id: string }

const conforme: OccurrenceView = {
  scheduledFor: '2026-07-14', // mardi
  status: 'planned',
  assignedTeamId: 'team-nord',
  startHHMM: '06:00',
  endHHMM: '09:00',
}

describe('Une occurrence CONFORME ne signale rien', () => {
  it('même jour, même équipe, même horaire → zéro déviation', () => {
    expect(detectDeviations(conforme, TPL)).toEqual([])
  })
})

describe('Chaque déviation est un FAIT nommé', () => {
  it('déplacée au mercredi → « Jour déplacé »', () => {
    const d = detectDeviations({ ...conforme, scheduledFor: '2026-07-15' }, TPL)
    expect(d.map((x) => x.kind)).toEqual(['date'])
    expect(d[0].label).toBe('Jour déplacé')
  })

  it('équipe Sud à la place de Nord → « Équipe changée »', () => {
    const d = detectDeviations({ ...conforme, assignedTeamId: 'team-sud' }, TPL)
    expect(d.map((x) => x.kind)).toEqual(['team'])
  })

  it('07:30 à la place de 06:00 → « Horaire modifié »', () => {
    const d = detectDeviations({ ...conforme, startHHMM: '07:30' }, TPL)
    expect(d.map((x) => x.kind)).toEqual(['time'])
  })

  it('annulée → « Annulée ce jour »', () => {
    const d = detectDeviations({ ...conforme, status: 'skipped' }, TPL)
    expect(d.map((x) => x.kind)).toEqual(['cancelled'])
  })

  it('les déviations se CUMULENT — déplacée ET changée d’équipe', () => {
    const d = detectDeviations(
      { ...conforme, scheduledFor: '2026-07-16', assignedTeamId: 'team-sud' },
      TPL,
    )
    expect(d.map((x) => x.kind).sort()).toEqual(['date', 'team'])
  })

  it('un rythme SANS équipe prescrite ne signale jamais « équipe changée »', () => {
    const libre = { ...TPL, assigned_team_id: null } as unknown as ProjectableTemplate
    expect(detectDeviations({ ...conforme, assignedTeamId: 'team-sud' }, libre)).toEqual([])
  })
})

describe('« Revenir » vise le jour PRESCRIT — jamais un souvenir', () => {
  it('déplacée au jeudi 16 → le mardi 14 est le prescrit le plus proche', () => {
    expect(prescribedDateNear(TPL, '2026-07-16')).toBe('2026-07-14')
  })

  it('à équidistance de deux mardis, le PASSÉ gagne — on déplace presque toujours vers l’avant', () => {
    // Le samedi 18 est à 4 jours du mardi 14 et à 3 du mardi 21 → le 21.
    // Le vendredi 17 est à 3 du 14 et à 4 du 21 → le 14.
    expect(prescribedDateNear(TPL, '2026-07-17')).toBe('2026-07-14')
    expect(prescribedDateNear(TPL, '2026-07-18')).toBe('2026-07-21')
  })

  it('un rythme TERMINÉ ne prescrit plus rien — on ne restaure pas vers le vide', () => {
    const fini = { ...TPL, ends_on: '2026-06-30' }
    expect(prescribedDateNear(fini, '2026-07-16')).toBeNull()
  })
})

describe('L’heure se compare telle que la grille l’affiche', () => {
  it('extrait HH:MM d’un horodatage', () => {
    expect(hhmmOf('2026-07-14T06:00:00.000Z')).toBe('06:00')
  })

  it('null et charabia ne cassent rien', () => {
    expect(hhmmOf(null)).toBeNull()
    expect(hhmmOf('demain matin')).toBeNull()
  })
})
