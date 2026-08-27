import { describe, it, expect } from 'vitest'
import { isProposalOccurrenceEligible } from '@/lib/db/canonical-subject-historical-occurrence'

// P3-B1 — l'éligibilité d'une occurrence dépend du CONTENU (état daté significatif d'un sujet
// durable), pas du type de proposition. Les familles à état restent éligibles ; `observation`
// devient éligible seulement si son texte est significatif (garde générique, pas de whitelist).

describe('isProposalOccurrenceEligible — familles à état (inchangées)', () => {
  it('action / decision / knowledge_fact / deadline → toujours éligibles', () => {
    for (const f of ['action', 'decision', 'knowledge_fact', 'deadline']) {
      expect(isProposalOccurrenceEligible(f, 'x', null)).toBe(true)
    }
  })
  it('famille inconnue / acteur → non éligible', () => {
    expect(isProposalOccurrenceEligible('company', 'Entreprise X', null)).toBe(false)
    expect(isProposalOccurrenceEligible('person', 'M. Dupont', null)).toBe(false)
    expect(isProposalOccurrenceEligible('inconnue', 'texte substantiel et informatif', null)).toBe(false)
  })
})

describe('isProposalOccurrenceEligible — observation (garde de signification)', () => {
  it('récupère les 2 cas cibles P3-A (états datés réels aujourd’hui perdus)', () => {
    expect(isProposalOccurrenceEligible('observation', 'Registre de sécurité installations électriques non renseigné', null)).toBe(true)
    expect(isProposalOccurrenceEligible('observation', 'Largeur de passage des dégagements réduite', null)).toBe(true)
  })
  it('rejette le transitoire/éphémère (marqueur temporel court, texte trop court)', () => {
    expect(isProposalOccurrenceEligible('observation', 'à voir', null)).toBe(false)
    expect(isProposalOccurrenceEligible('observation', 'demain', null)).toBe(false)
    expect(isProposalOccurrenceEligible('observation', 'RAS', null)).toBe(false)
    expect(isProposalOccurrenceEligible('observation', 'à confirmer', null)).toBe(false)
  })
  it('utilise la description si le label est vide/court', () => {
    expect(isProposalOccurrenceEligible('observation', '', 'Porte coupe-feu maintenue ouverte par une cale, non conforme')).toBe(true)
    expect(isProposalOccurrenceEligible('observation', 'RAS', 'Contrôle réalisé, aucune remarque particulière ce jour')).toBe(true)
  })
  it('label ET description vides/triviaux → non éligible', () => {
    expect(isProposalOccurrenceEligible('observation', '', '')).toBe(false)
    expect(isProposalOccurrenceEligible('observation', 'ok', null)).toBe(false)
  })
  it('limite connue documentée : une observation substantielle mais transitoire n’est PAS filtrée ici', () => {
    // isInformativeText est un garde longueur/temporel, pas sémantique. « Il pleuvait ce jour-là »
    // passe → résidu assumé (instrumenté, traité seulement si le terrain le montre). Test-témoin
    // pour que ce comportement soit explicite, pas accidentel.
    expect(isProposalOccurrenceEligible('observation', 'Il pleuvait ce jour sur le chantier', null)).toBe(true)
  })
})
