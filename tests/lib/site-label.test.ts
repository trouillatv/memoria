// PR 4 — « Pointière » ne veut rien dire tout seul (constat Guillaume).
// L'identité d'un chantier, c'est le client ET le lieu.

import { describe, it, expect } from 'vitest'
import { siteLabel } from '@/lib/labels/site-label'

describe('siteLabel', () => {
  it('client + chantier → « Client — Chantier »', () => {
    expect(siteLabel('Pointière', 'Discount')).toBe('Discount — Pointière')
  })

  it('deux chantiers homonymes restent distinguables', () => {
    expect(siteLabel('Pointière', 'Discount')).not.toBe(siteLabel('Pointière', 'Mairie'))
  })

  it('sans client → le nom seul, jamais un tiret orphelin', () => {
    expect(siteLabel('Pointière', null)).toBe('Pointière')
    expect(siteLabel('Pointière', undefined)).toBe('Pointière')
    expect(siteLabel('Pointière', '   ')).toBe('Pointière')
  })
})
