// Non-régression du correctif « un clic = une continuité » (Lot 2 · PR1 suite) :
// cliquer une action sur la liste Actions ouvre sa fiche EN SURIMPRESSION sur
// /actions, JAMAIS une navigation vers la page du chantier.

import { describe, it, expect } from 'vitest'
import { actionFicheHref } from '@/lib/knowledge/actions-dashboard-model'

describe('actionFicheHref — la fiche Action s\'ouvre sur /actions, pas sur le chantier', () => {
  it('ouvre ?action= en surimpression sur /actions (avec le site pour charger la fiche)', () => {
    expect(actionFicheHref('a1', 's9')).toBe('/actions?action=a1&action_site=s9&action_source=actions')
  })

  it('ne navigue JAMAIS vers la page chantier (/sites/…)', () => {
    const href = actionFicheHref('a1', 's9')
    expect(href.startsWith('/actions?action=')).toBe(true)
    expect(href.startsWith('/sites/')).toBe(false)
  })
})
