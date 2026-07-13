// Lot D — « Retirer » : la doctrine, prouvée à sec.
//
// L'invariant qu'on protège ici : **une preuve n'est jamais détruite par un
// geste de rangement**. Un hard delete n'est autorisé que sur un objet SANS
// descendance (l'essai de Guillaume). Le reste sort des écrans, la mémoire reste.

import { describe, it, expect } from 'vitest'
import { decideMissionRemoval, decideClientRemoval } from '@/lib/removal/policy'

describe('decideMissionRemoval', () => {
  it('zéro intervention (essai pur) → suppression définitive assumée', () => {
    const d = decideMissionRemoval(0)
    expect(d).toMatchObject({ allowed: true, mode: 'hard' })
  })

  it('au moins une intervention → SOFT (la cascade détruirait les photos-preuves)', () => {
    const d = decideMissionRemoval(1)
    expect(d).toMatchObject({ allowed: true, mode: 'soft' })
    if (d.allowed) expect(d.consequence).toMatch(/preuves restent conservées/i)
  })

  it('la conséquence dit le nombre réel d’interventions', () => {
    const d = decideMissionRemoval(12)
    if (d.allowed) expect(d.consequence).toContain('12 interventions')
  })

  it('jamais de hard delete dès qu’il existe un historique', () => {
    for (const n of [1, 2, 50]) {
      const d = decideMissionRemoval(n)
      expect(d.allowed && d.mode).toBe('soft')
    }
  })
})

describe('decideClientRemoval', () => {
  it('chantiers actifs → BLOQUÉ, avec le nombre et quoi faire', () => {
    const d = decideClientRemoval(3)
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.reason).toContain('3 chantiers actifs')
      expect(d.reason).toMatch(/Retirez-les d’abord/i)
    }
  })

  it('un seul chantier → message au singulier', () => {
    const d = decideClientRemoval(1)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toContain('1 chantier actif')
  })

  it('aucun chantier actif → soft (archivage), JAMAIS hard', () => {
    const d = decideClientRemoval(0)
    expect(d).toMatchObject({ allowed: true, mode: 'soft' })
  })
})
