// La fragmentation silencieuse de la mémoire.
//
// Guillaume écrit « Nettoyage magasin ». Trois mois plus tard : « Nettoyage
// Magasin ». Puis « nettoyage  magasin ». Rien ne casse, rien n'alerte — et la
// mémoire se coupe en morceaux. Un jour, « combien de nettoyages de magasin
// fait-on ? » n'a plus de réponse.
//
// C'est le pire type de dégât pour un produit de mémoire : il est INVISIBLE.

import { describe, it, expect } from 'vitest'
import {
  normalizePrestation,
  samePrestation,
  findExistingPrestation,
  suggestExisting,
} from '@/lib/planning/prestation-name'

describe('On compare sans casse, sans accents, sans espaces en trop', () => {
  it('la casse ne fait pas deux travaux', () => {
    expect(samePrestation('Nettoyage magasin', 'nettoyage magasin')).toBe(true)
    expect(samePrestation('NETTOYAGE MAGASIN', 'Nettoyage Magasin')).toBe(true)
  })

  it('les ACCENTS ne font pas deux travaux — `ilike` ne le sait pas, nous si', () => {
    expect(samePrestation('Entretien général', 'Entretien general')).toBe(true)
    expect(samePrestation('Réfection sol', 'refection sol')).toBe(true)
  })

  it('un espace en trop ne fait pas deux travaux', () => {
    expect(samePrestation('nettoyage  magasin', 'nettoyage magasin')).toBe(true)
    expect(samePrestation('  Nettoyage magasin  ', 'Nettoyage magasin')).toBe(true)
  })

  it('deux travaux DIFFÉRENTS restent différents', () => {
    expect(samePrestation('Nettoyage', 'Nettoyage des vitres')).toBe(false)
    expect(samePrestation('Entretien école', 'Entretien magasin')).toBe(false)
  })

  it('la forme canonique ne sert QU’À comparer — jamais à afficher', () => {
    expect(normalizePrestation('  Nettoyage  Magasin  ')).toBe('nettoyage magasin')
  })
})

describe('On PROPOSE l’existante — on ne l’impose jamais', () => {
  const known = ['Nettoyage magasin', 'Entretien général']

  it('une variante typographique est signalée', () => {
    expect(suggestExisting('Nettoyage Magasin', known)).toBe('Nettoyage magasin')
    expect(suggestExisting('nettoyage  magasin', known)).toBe('Nettoyage magasin')
    expect(suggestExisting('Entretien general', known)).toBe('Entretien général')
  })

  it('l’orthographe EXACTE ne signale rien — on réutilise en silence', () => {
    // Il n'y a rien à lui dire : c'est déjà le bon nom.
    expect(suggestExisting('Nettoyage magasin', known)).toBeNull()
  })

  it('un travail VRAIMENT nouveau ne déclenche aucune suggestion', () => {
    expect(suggestExisting('Décapage sol', known)).toBeNull()
  })

  it('on ne rapproche JAMAIS deux travaux différents — mieux vaut deux entrées qu’une fusion fausse', () => {
    // Aucune « ressemblance » floue : « Nettoyage » et « Nettoyage des vitres »
    // sont deux métiers, et une distance de Levenshtein ne le sait pas.
    expect(suggestExisting('Nettoyage', known)).toBeNull()
    expect(suggestExisting('Nettoyage magasins', known)).toBeNull() // pluriel = autre nom
  })

  it('un nom vide ne rapproche rien', () => {
    expect(findExistingPrestation('   ', known)).toBeNull()
  })
})
