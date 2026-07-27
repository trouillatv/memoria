// Lot 2A — union LECTURE des responsables possibles d'une action de chantier :
// casting actif ∪ agents terrain des équipes affectées. Logique de fusion PURE,
// prouvée sans base. Un changement d'affectation d'équipe change les candidats.

import { describe, expect, it } from 'vitest'
import { mergeResponsibleCandidates } from '@/lib/knowledge/action-responsible-candidates'

const casting = [
  { id: 'c-marie', fullName: 'Marie Martin', function: 'Conductrice', companyName: 'MOE' },
  { id: 'c-paul', fullName: 'Paul Durand', function: 'Chef de chantier', companyName: 'Gros œuvre SARL' },
]
const teamAgents = [
  { contactId: 'c-jean', fullName: 'Jean Dupont', job: 'Électricien', companyName: null, teamName: 'Électricité' },
  // Paul est AUSSI dans une équipe affectée → provenance double, jamais dupliqué.
  { contactId: 'c-paul', fullName: 'Paul Durand', job: 'Chef', companyName: null, teamName: 'Gros œuvre' },
]

describe('mergeResponsibleCandidates', () => {
  it('unit le casting et les agents d’équipe, trié par nom', () => {
    const r = mergeResponsibleCandidates(casting, teamAgents)
    expect(r.map((c) => c.fullName)).toEqual(['Jean Dupont', 'Marie Martin', 'Paul Durand'])
  })

  it('un agent d’équipe seul est candidat, provenance équipe', () => {
    const jean = mergeResponsibleCandidates(casting, teamAgents).find((c) => c.contactId === 'c-jean')!
    expect(jean).toMatchObject({ fromCasting: false, teams: ['Électricité'], fonction: 'Électricien' })
  })

  it('une personne à la fois casting ET équipe n’apparaît qu’UNE fois, double provenance', () => {
    const paul = mergeResponsibleCandidates(casting, teamAgents).find((c) => c.contactId === 'c-paul')!
    expect(paul.fromCasting).toBe(true)
    expect(paul.teams).toEqual(['Gros œuvre'])
    // L'info du casting (fonction/entreprise) n'est pas écrasée par l'équipe.
    expect(paul.fonction).toBe('Chef de chantier')
    expect(paul.companyName).toBe('Gros œuvre SARL')
    // Une seule occurrence de c-paul.
    expect(mergeResponsibleCandidates(casting, teamAgents).filter((c) => c.contactId === 'c-paul')).toHaveLength(1)
  })

  it('le même agent dans deux équipes affectées : les deux provenances, sans doublon', () => {
    const twoTeams = [
      { contactId: 'c-jean', fullName: 'Jean Dupont', job: 'Électricien', companyName: null, teamName: 'Électricité' },
      { contactId: 'c-jean', fullName: 'Jean Dupont', job: 'Électricien', companyName: null, teamName: 'CFA' },
    ]
    const r = mergeResponsibleCandidates([], twoTeams)
    expect(r).toHaveLength(1)
    expect(r[0].teams).toEqual(['Électricité', 'CFA'])
  })

  it('CHANGEMENT D’AFFECTATION : sans équipe affectée, l’agent n’est plus candidat', () => {
    // Simule le retrait de l'équipe du chantier → teamAgents vide.
    const r = mergeResponsibleCandidates(casting, [])
    expect(r.find((c) => c.contactId === 'c-jean')).toBeUndefined()
    // Le casting, lui, reste intact (les actions déjà affectées ne sont pas touchées).
    expect(r.map((c) => c.contactId).sort()).toEqual(['c-marie', 'c-paul'])
  })

  it('aucune source → aucun candidat', () => {
    expect(mergeResponsibleCandidates([], [])).toEqual([])
  })
})
