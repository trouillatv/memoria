import { describe, expect, it } from 'vitest'

import {
  filterIntervenantUsersForScope,
  getDemoClientScopeForViewerEmail,
} from '@/lib/db/intervenants'

describe('intervenants demo scoping', () => {
  it('scopes Adrien to the BatiSud demo client', () => {
    expect(getDemoClientScopeForViewerEmail('adrien@memoria.nc')).toBe('BatiSud Construction')
    expect(getDemoClientScopeForViewerEmail('guillaume.demene@memoria.nc')).toBeNull()
  })

  it('filters intervenants to the scoped demo user set', () => {
    const rows = [
      { id: 'adrien', email: 'adrien@memoria.nc' },
      { id: 'chef-batisud', email: 'chef.batisud@memoria.nc' },
      { id: 'guillaume', email: 'guillaume.demene@memoria.nc' },
      { id: 'chef-mvo', email: 'chef.mvo@memoria.nc' },
    ]

    expect(filterIntervenantUsersForScope(rows, new Set(['adrien', 'chef-batisud']))).toEqual([
      rows[0],
      rows[1],
    ])
  })
})
