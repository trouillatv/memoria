// PR 1 — continuité « fiche chantier → Planifier → semaine ».
// Reproduction du cas Guillaume (2026-07-13) : depuis Pointière Discount,
// cliquer Planifier doit arriver sur le planificateur avec CE chantier déjà
// sélectionné. Le préremplissage est un helper pur : on le teste à sec.

import { describe, it, expect } from 'vitest'
import { pickInitialMissionId, type PrefillMission } from '@/app/(dashboard)/semaine/planning-prefill'

const m = (id: string, name: string, siteId: string, contractName = 'Contrat'): PrefillMission => ({
  id, name, siteId, contractName,
})

const POINTIERE = 'site-pointiere'
const AUTRE = 'site-autre'

describe('pickInitialMissionId — contexte chantier', () => {
  it('sans contexte → aucun préremplissage', () => {
    expect(pickInitialMissionId([m('m1', 'Entretien', POINTIERE)], undefined)).toBe('')
  })

  it('préselectionne la mission du chantier d’origine', () => {
    const missions = [m('m1', 'Vitres', AUTRE), m('m2', 'Entretien du magasin', POINTIERE)]
    expect(pickInitialMissionId(missions, POINTIERE)).toBe('m2')
  })

  it('plusieurs missions sur le chantier → la première dans l’ordre d’affichage (nom fr, puis contrat)', () => {
    const missions = [
      m('m-vitres', 'Vitres', POINTIERE),
      m('m-entretien', 'Entretien du magasin', POINTIERE),
      m('m-eclairage', 'Éclairage', POINTIERE), // tri fr : É se range avec E
    ]
    expect(pickInitialMissionId(missions, POINTIERE)).toBe('m-eclairage')
  })

  it('à nom égal, départage par contrat', () => {
    const missions = [
      m('m-b', 'Entretien', POINTIERE, 'Contrat B'),
      m('m-a', 'Entretien', POINTIERE, 'Contrat A'),
    ]
    expect(pickInitialMissionId(missions, POINTIERE)).toBe('m-a')
  })

  it('chantier sans mission → pas de préremplissage (le dialogue reste vierge)', () => {
    expect(pickInitialMissionId([m('m1', 'Vitres', AUTRE)], POINTIERE)).toBe('')
  })

  it('chantier inconnu (id étranger, déjà filtré serveur) → ignoré', () => {
    expect(pickInitialMissionId([m('m1', 'Vitres', AUTRE)], 'site-inexistant')).toBe('')
  })
})
