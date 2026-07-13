// Lot S — la décision d'appartenance, testée à sec (le fetch vit ailleurs).
// Ce que ces tests garantissent : un id d'un AUTRE tenant, ou un id inventé,
// ne franchit jamais une écriture — quel que soit le rôle (sauf admin
// plateforme, seule exception doctrinale).

import { describe, it, expect } from 'vitest'
import { decideOwnership } from '@/lib/auth/ownership-policy'

const MINE = 'org-servinor'
const OTHER = 'org-agp'

describe('decideOwnership', () => {
  it('manager, objet de son organisation → autorisé', () => {
    expect(
      decideOwnership({ role: 'manager', callerOrgId: MINE, objectOrgId: MINE }),
    ).toEqual({ allowed: true })
  })

  it('manager, objet d’un AUTRE tenant → refusé (IDOR d’écriture)', () => {
    const d = decideOwnership({ role: 'manager', callerOrgId: MINE, objectOrgId: OTHER })
    expect(d.allowed).toBe(false)
  })

  it('chef d’équipe, objet d’un autre tenant → refusé', () => {
    expect(
      decideOwnership({ role: 'chef_equipe', callerOrgId: MINE, objectOrgId: OTHER }).allowed,
    ).toBe(false)
  })

  it('objet inexistant → refusé, MÊME message qu’un objet étranger (pas d’oracle)', () => {
    const absent = decideOwnership({ role: 'manager', callerOrgId: MINE, objectOrgId: undefined })
    const foreign = decideOwnership({ role: 'manager', callerOrgId: MINE, objectOrgId: OTHER })
    expect(absent.allowed).toBe(false)
    expect(foreign.allowed).toBe(false)
    expect(absent).toEqual(foreign) // ne révèle pas l'existence d'un objet étranger
  })

  it('appelant sans organisation → refusé (fail-closed, jamais d’élargissement)', () => {
    expect(
      decideOwnership({ role: 'manager', callerOrgId: null, objectOrgId: MINE }).allowed,
    ).toBe(false)
  })

  it('objet orphelin (organization_id null) → refusé explicitement', () => {
    const d = decideOwnership({ role: 'manager', callerOrgId: MINE, objectOrgId: null })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.error).toMatch(/sans organisation/i)
  })

  it('admin = super-admin plateforme → passe (seule exception)', () => {
    expect(
      decideOwnership({ role: 'admin', callerOrgId: null, objectOrgId: OTHER }).allowed,
    ).toBe(true)
  })

  it('admin sur un objet inexistant → refusé quand même', () => {
    expect(
      decideOwnership({ role: 'admin', callerOrgId: null, objectOrgId: undefined }).allowed,
    ).toBe(false)
  })
})
