import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { OrgBadge, orgLabelOf, type OrgLabels } from '@/components/dashboard/OrgBadge'

// M3 — le contrat du badge d'organisation :
//   · mono-org (labels = null) → AUCUN badge, interface inchangée ;
//   · multi-org → chaque élément porte SA provenance.

describe('orgLabelOf — résolution partagée, jamais N+1', () => {
  const labels: OrgLabels = { agp: 'AGP', srv: 'SERVINOR' }

  it('mono-org : labels null → aucun libellé (donc aucun badge)', () => {
    expect(orgLabelOf(null, 'agp')).toBeUndefined()
  })

  it('multi-org : chaque id résout SON libellé depuis la map', () => {
    expect(orgLabelOf(labels, 'agp')).toBe('AGP')
    expect(orgLabelOf(labels, 'srv')).toBe('SERVINOR')
  })

  it('id absent / vide → pas de libellé (pas de badge fantôme)', () => {
    expect(orgLabelOf(labels, 'inconnu')).toBeUndefined()
    expect(orgLabelOf(labels, undefined)).toBeUndefined()
    expect(orgLabelOf(labels, '')).toBeUndefined()
  })
})

describe('OrgBadge — présentation', () => {
  it('sans libellé → ne rend RIEN (mono-org : DOM inchangé)', () => {
    const { container } = render(<OrgBadge label={orgLabelOf(null, 'agp')} />)
    expect(container.firstChild).toBeNull()
  })

  it('avec libellé → rend le badge (provenance visible)', () => {
    const { getByText, getByTitle } = render(<OrgBadge label="SERVINOR" />)
    expect(getByText('SERVINOR')).toBeTruthy()
    expect(getByTitle('Organisation : SERVINOR')).toBeTruthy()
  })
})
