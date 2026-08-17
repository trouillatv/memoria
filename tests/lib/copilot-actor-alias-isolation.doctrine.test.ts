import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// ── createCopilotActorAlias — organizationId n'est jamais la parole du client ──
// (Vincent, mandat P4-B.2, Correction #2)
//
// « actor_alias » n'a pas de contrainte FK composite reliant company_id/
// contact_id à organization_id (schéma mig 327) : rien en base n'empêche
// d'écrire un alias pointant vers l'acteur d'une AUTRE organisation si le
// serveur fait confiance à un organization_id fourni par l'appelant. La
// garantie vit donc entièrement dans le code de la primitive — d'où ce test
// qui échoue si quelqu'un l'affaiblit un jour.
//
// Test de code, pas de DB : cette suite n'a pas de harnais Supabase mocké
// pour les server actions (cf. tests/lib/site-access.doctrine.test.ts, même
// approche). Il vérifie la SOURCE plutôt que le comportement à l'exécution.

const FILE = join(process.cwd(), 'app/(dashboard)/sites/[id]/copilot-write-action.ts')

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function actorAliasFunction(): string {
  const src = readFileSync(FILE, 'utf8')
  const start = src.indexOf('export async function createCopilotActorAlias')
  expect(start, 'createCopilotActorAlias introuvable dans copilot-write-action.ts').toBeGreaterThan(-1)
  const end = src.indexOf('\nexport ', start + 1)
  return src.slice(start, end === -1 ? undefined : end)
}

describe('createCopilotActorAlias — isolation tenant (P4-B.2)', () => {
  it("le schéma d'entrée n'accepte pas d'organizationId — impossible à spoofer depuis le client", () => {
    const src = codeOf(FILE)
    const schemaStart = src.indexOf('const createActorAliasSchema')
    const schemaEnd = src.indexOf('})', schemaStart) + 2
    const schema = src.slice(schemaStart, schemaEnd)
    expect(schema).not.toMatch(/organizationId|organization_id/)
  })

  it('organizationId vient uniquement de requireSiteAccess, jamais de parsed.data', () => {
    const fn = actorAliasFunction()
    expect(fn).toContain('requireSiteAccess(siteId)')
    expect(fn).toContain('organizationId = access.organizationId')
    // La seule autre affectation valable est la déclaration de type ; aucune
    // depuis `parsed.data` ou un champ nommé organizationId côté input.
    expect(fn).not.toMatch(/organizationId\s*=\s*parsed\.data/)
    expect(fn).not.toMatch(/organizationId\s*=\s*rawInput/)
  })

  it('la cible company est revérifiée avec organization_id = celui de requireSiteAccess', () => {
    const fn = actorAliasFunction()
    const companyBlock = fn.slice(fn.indexOf("targetKind === 'company'"), fn.indexOf('} else {'))
    expect(companyBlock).toContain(".from('companies')")
    expect(companyBlock).toContain(".eq('organization_id', organizationId)")
  })

  it('la cible contact est revérifiée avec organization_id = celui de requireSiteAccess', () => {
    const fn = actorAliasFunction()
    const contactBlock = fn.slice(fn.indexOf('} else {'), fn.indexOf("if (!contact)") + 40)
    expect(contactBlock).toContain(".from('company_contacts')")
    expect(contactBlock).toContain(".eq('organization_id', organizationId)")
  })

  it("l'insert écrit organization_id = organizationId (requireSiteAccess), jamais un champ transmis", () => {
    const fn = actorAliasFunction()
    const insertBlock = fn.slice(fn.indexOf(".from('actor_alias')\n    .insert("), fn.indexOf('.select(\'id\')\n    .single()'))
    expect(insertBlock).toContain('organization_id: organizationId,')
  })
})
