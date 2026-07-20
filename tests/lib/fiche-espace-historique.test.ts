import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  noterFiche,
  profondeur,
  terminerParcours,
} from '../../app/(dashboard)/sites/[id]/views/fiche-espace-historique'

// L'invariant protégé ici : après une fermeture par ×, un Précédent ne doit pas
// rouvrir une fiche. Cela suppose de consommer EXACTEMENT les entrées du parcours.
// Une erreur d'un cran est invisible en lecture de code et très visible à l'usage.

const DEC = '/sites/s1/decision/d1'
const ACT = '/sites/s1/action/a1'

describe('espace des fiches — profondeur du parcours', () => {
  beforeEach(() => {
    terminerParcours() // remet la pile à zéro
  })

  it('compte un maillon par objet parcouru vers l’avant', () => {
    noterFiche(DEC)
    expect(profondeur()).toBe(1)
    noterFiche(ACT)
    expect(profondeur()).toBe(2)
  })

  it('décompte quand on revient en arrière sur un maillon déjà visité', () => {
    noterFiche(DEC)
    noterFiche(ACT)
    noterFiche(DEC) // Précédent navigateur
    expect(profondeur()).toBe(1)
  })

  it('consomme autant d’entrées que de maillons, puis repart de zéro', () => {
    const go = vi.fn()
    vi.stubGlobal('history', { go })
    noterFiche(DEC)
    noterFiche(ACT)

    expect(terminerParcours()).toBe(true)
    expect(go).toHaveBeenCalledWith(-2)
    expect(profondeur()).toBe(0)

    vi.unstubAllGlobals()
  })

  it('signale qu’un repli est nécessaire quand il n’y a rien à consommer', () => {
    // Cas du rechargement direct : la pile est vide, l’historique ne peut pas
    // ramener au contexte — l’appelant doit naviguer explicitement.
    expect(terminerParcours()).toBe(false)
  })
})
