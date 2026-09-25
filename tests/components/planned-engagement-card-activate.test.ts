// P0-3.2 (mandat Vincent 2026-09-25) — le CTA « Mettre en vigueur » n'apparaît
// que sur une carte curated ET quand canActivate=true. ActivateEngagementButton
// est un composant client à hooks : on ne l'invoque pas (comme
// AddPlannedEngagementDialog ailleurs), on vérifie sa PRÉSENCE dans l'arbre non
// monté par référence de type, sans l'appeler.

import { describe, it, expect } from 'vitest'
import { PlannedEngagementCard } from '@/components/engagements/PlannedEngagementCard'
import type { PlannedEngagement } from '@/lib/db/engagements'

function engagement(overrides: Partial<PlannedEngagement> = {}): PlannedEngagement {
  return {
    id: 'eng-1',
    shortLabel: 'Nettoyage hebdomadaire des vitres',
    category: 'frequency',
    kind: null,
    measurable: false,
    status: 'curated',
    createdAt: '2026-09-01T00:00:00Z',
    primaryProvenance: { documentId: null, documentFilename: null, pageNumber: null, excerpt: null, frequencyRaw: null },
    additionalProvenance: [],
    ...overrides,
  }
}

function containsActivateButton(node: unknown): boolean {
  if (node == null || typeof node === 'boolean') return false
  if (typeof node === 'string') return false
  if (Array.isArray(node)) return node.some(containsActivateButton)
  const el = node as { type?: unknown; props?: { children?: unknown; engagementId?: unknown } }
  if (typeof el.type === 'function' && (el.type as { name?: string }).name === 'ActivateEngagementButton') {
    return true
  }
  if (typeof el.type === 'function') return false // ne pas invoquer d'autres fonctions (hooks potentiels)
  return el.props ? containsActivateButton(el.props.children) : false
}

describe('PlannedEngagementCard — CTA « Mettre en vigueur »', () => {
  it('curated + canActivate=true : le bouton est présent', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ status: 'curated' }), showStatusBadge: true, canActivate: true })
    expect(containsActivateButton(tree)).toBe(true)
  })

  it('curated + canActivate=false : le bouton est absent', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ status: 'curated' }), showStatusBadge: true, canActivate: false })
    expect(containsActivateButton(tree)).toBe(false)
  })

  it('canActivate omis (par défaut) : le bouton est absent', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ status: 'curated' }), showStatusBadge: true })
    expect(containsActivateButton(tree)).toBe(false)
  })

  it('active + canActivate=true : le bouton est absent (déjà en vigueur)', () => {
    const tree = PlannedEngagementCard({ engagement: engagement({ status: 'active' }), showStatusBadge: true, canActivate: true })
    expect(containsActivateButton(tree)).toBe(false)
  })
})
