// Lot S / M3-B — la décision d'appartenance sur les ÉCRITURES.
//
// Doctrine M3-B : l'accès en écriture vient de l'APPARTENANCE à l'organisation DE
// L'OBJET muté — jamais de l'org par défaut de l'appelant, jamais d'une exemption
// de rôle. Un id d'un AUTRE tenant (ou un admin plateforme sans appartenance) ne
// franchit jamais une écriture. Le comportement runtime (lecture de l'org + de
// l'appartenance) est prouvé dynamiquement contre la base ; ici on protège la
// décision pure ET l'absence de tout contournement dans `ownership.ts`.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { decideOwnership } from '@/lib/auth/ownership-policy'

describe('decideOwnership — membre de l’org DE L’OBJET, aucune exemption', () => {
  it('membre de l’org de l’objet → autorisé', () => {
    expect(decideOwnership({ objectOrgId: 'org-servinor', isMemberOfObjectOrg: true })).toEqual({ allowed: true })
  })

  it('NON membre de l’org de l’objet → refusé (IDOR d’écriture fermé)', () => {
    expect(decideOwnership({ objectOrgId: 'org-agp', isMemberOfObjectOrg: false }).allowed).toBe(false)
  })

  it('objet inexistant → refusé, MÊME résultat qu’un objet étranger (pas d’oracle)', () => {
    const absent = decideOwnership({ objectOrgId: undefined, isMemberOfObjectOrg: false })
    const foreign = decideOwnership({ objectOrgId: 'org-agp', isMemberOfObjectOrg: false })
    expect(absent.allowed).toBe(false)
    expect(foreign.allowed).toBe(false)
    expect(absent).toEqual(foreign) // ne révèle pas l'existence d'un objet étranger
  })

  it('objet orphelin (organization_id null) → refusé explicitement', () => {
    const d = decideOwnership({ objectOrgId: null, isMemberOfObjectOrg: false })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.error).toMatch(/sans organisation/i)
  })

  it('l’appartenance est NÉCESSAIRE — plus aucune porte dérobée par le rôle', () => {
    // La décision ne connaît plus le rôle : un admin plateforme sans appartenance
    // arrive ici avec `isMemberOfObjectOrg: false` → refusé, comme tout non-membre.
    expect(decideOwnership({ objectOrgId: 'org-agp', isMemberOfObjectOrg: false }).allowed).toBe(false)
  })
})

describe('requireOwned — plus de getOrgId, plus d’exemption admin (source)', () => {
  const src = readFileSync(join(process.cwd(), 'lib/auth/ownership.ts'), 'utf8')
  const policy = readFileSync(join(process.cwd(), 'lib/auth/ownership-policy.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const policyCode = policy.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('n’appelle plus getOrgId() (org du caller)', () => {
    expect(code).not.toMatch(/getOrgId\s*\(/)
    expect(code).not.toMatch(/import[^\n]*getOrgId/)
  })

  it('la garde vient de l’appartenance à l’org de la ressource', () => {
    expect(code).toMatch(/requireOrganizationMembership\(objectOrgId\)/)
  })

  it('AUCUNE exemption `role === "admin"` ne subsiste (ni ownership, ni policy)', () => {
    expect(code).not.toMatch(/role === 'admin'/)
    expect(policyCode).not.toMatch(/role === 'admin'/)
  })
})
