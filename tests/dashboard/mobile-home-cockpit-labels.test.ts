import { describe, expect, it } from 'vitest'
import { familyLabel, ctaLabel } from '@/app/(dashboard)/dashboard/MobileHomeCockpit'
import type { AttentionCard } from '@/lib/situations/attention/types'

/**
 * Les types métier ne sont pas interchangeables : action ≠ réserve.
 *
 * La projection donne `icon: 'warning'` à `stale_action` COMME à `open_reserve`
 * (lib/situations/attention/project.ts). Un rendu qui tranche sur `icon` seul
 * affiche donc « RÉSERVE OUVERTE » sur une action ancienne, et propose « Voir la
 * réserve » sur un objet qui n'est pas une réserve. Ces tests interdisent le
 * retour en arrière : tant que `kind` est présent, il prime sur `icon`.
 */

const card = (over: Partial<AttentionCard> = {}): AttentionCard => ({
  id: 'c1',
  icon: 'warning',
  tone: 'amber',
  priority: 10,
  title: 'Reprendre le calfeutrement',
  description: null,
  siteLabel: 'Lycée Petro Attiti',
  secondaryActions: [],
  subject: null,
  resolutions: [],
  ...over,
})

describe('MobileHomeCockpit — le libellé suit le type métier, pas l’icône', () => {
  it('une action ancienne ne s’affiche jamais comme une réserve', () => {
    const action = card({ kind: 'stale_action' })
    expect(familyLabel(action)).toBe('ACTION ANCIENNE')
    expect(ctaLabel(action)).toBe("Voir l'action")
  })

  it('une action ancienne critique reste une action', () => {
    const action = card({ kind: 'stale_action', tone: 'red' })
    expect(familyLabel(action)).not.toContain('RÉSERVE')
    expect(ctaLabel(action)).toBe("Voir l'action")
  })

  it('une réserve reste une réserve, avec son niveau', () => {
    expect(familyLabel(card({ kind: 'open_reserve' }))).toBe('RÉSERVE OUVERTE')
    expect(familyLabel(card({ kind: 'open_reserve', tone: 'red' }))).toBe('RÉSERVE CRITIQUE')
    expect(ctaLabel(card({ kind: 'open_reserve' }))).toBe('Voir la réserve')
  })

  it('sans `kind`, le repli sur l’icône reste inchangé', () => {
    expect(familyLabel(card())).toBe('RÉSERVE OUVERTE')
    expect(ctaLabel(card())).toBe('Voir la réserve')
  })
})
