// #229 Lot A — narration de la trajectoire dans l'Attention (occurrence-first).
// « Toujours ouvert » interdit comme fallback quand une transition plus précise existe ;
// autorisé uniquement pour une continuité réelle (maintenu/open).

import { describe, it, expect } from 'vitest'
import { narrateTrajectory } from './canonical-attention'

const DATE = '2025-08-05'

describe('narrateTrajectory — matrice de transitions', () => {
  it('resolved → open (réouvert) → « Réouvert », jamais « Toujours ouvert »', () => {
    const r = narrateTrajectory('réouvert', 'open', true, DATE)
    expect(r).toMatch(/Réouvert/)
    expect(r).not.toMatch(/Toujours ouvert/)
  })

  it('open → open (maintenu) → continuité « Toujours ouvert » (LÉGITIME)', () => {
    expect(narrateTrajectory('maintenu', 'open', true, DATE)).toBe('Toujours ouvert lors de la dernière visite')
  })

  it('X → gap (non_mentionné) → « Non mentionné dans le dernier PV », jamais « Toujours ouvert »', () => {
    const r = narrateTrajectory('non_mentionné', null, false, DATE)
    expect(r).toMatch(/Non mentionné dans le dernier PV/)
    expect(r).not.toMatch(/Toujours ouvert/)
  })

  it('non_mentionné avec objet encore ouvert (isOpen faux car currentStatus null) → non-mention explicite', () => {
    // Séparation des flux : action ouverte mais sujet non mentionné au dernier PV.
    const r = narrateTrajectory('non_mentionné', null, true, DATE)
    expect(r).toBe('Non mentionné dans le dernier PV · état précédent conservé')
  })

  it('nouveau / réapparu → « Apparu au PV… »', () => {
    expect(narrateTrajectory('nouveau', 'open', true, DATE)).toMatch(/Apparu au PV/)
    expect(narrateTrajectory('réapparu', 'open', true, DATE)).toMatch(/Apparu au PV/)
  })

  it('aggravé → « Aggravé au dernier PV » (distinct de réouvert)', () => {
    expect(narrateTrajectory('aggravé', 'non_compliant', true, DATE)).toMatch(/Non-conformité/) // NC prime
    expect(narrateTrajectory('aggravé', 'open', true, DATE)).toBe('Aggravé au dernier PV')
  })

  it('open → resolved (levé/réalisé) → jamais raconté comme ouvert (null)', () => {
    expect(narrateTrajectory('levé', 'done', false, DATE)).toBeNull()
    expect(narrateTrajectory('réalisé', 'done', false, DATE)).toBeNull()
  })

  it('non-conformité (statut) prime sur la trajectoire', () => {
    expect(narrateTrajectory('maintenu', 'non_compliant', true, DATE)).toBe('Non-conformité signalée dans le dernier PV')
  })

  it('transition inconnue + ouvert → continuité ; + fermé → rien (jamais inventer)', () => {
    expect(narrateTrajectory(undefined, 'open', true, DATE)).toBe('Toujours ouvert lors de la dernière visite')
    expect(narrateTrajectory(undefined, null, false, DATE)).toBeNull()
  })
})
