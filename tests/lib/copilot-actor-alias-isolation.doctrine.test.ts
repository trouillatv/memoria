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
// Depuis l'extraction du cœur d'écriture vers lib/db/actor-alias-write.ts
// (harnais de recette réversible, 2026-08-17), la garantie est répartie sur
// deux frontières : le wrapper (copilot-write-action.ts) doit résoudre
// organizationId UNIQUEMENT via requireSiteAccess et ne jamais le faire
// transiter par parsed.data/rawInput ; le cœur (actor-alias-write.ts) doit
// revérifier la cible avec cet organizationId avant tout insert. Un script de
// recette qui appelle confirmActorAlias() directement (hors HTTP/cookies) est
// donc soumis à la même revérification serveur que la production.
//
// Test de code, pas de DB : cette suite n'a pas de harnais Supabase mocké
// pour les server actions (cf. tests/lib/site-access.doctrine.test.ts, même
// approche). Il vérifie la SOURCE plutôt que le comportement à l'exécution.

const WRAPPER_FILE = join(process.cwd(), 'app/(dashboard)/sites/[id]/copilot-write-action.ts')
const CORE_FILE = join(process.cwd(), 'lib/db/actor-alias-write.ts')

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function wrapperFunction(): string {
  const src = readFileSync(WRAPPER_FILE, 'utf8')
  const start = src.indexOf('export async function createCopilotActorAlias')
  expect(start, 'createCopilotActorAlias introuvable dans copilot-write-action.ts').toBeGreaterThan(-1)
  const end = src.indexOf('\nexport ', start + 1)
  return src.slice(start, end === -1 ? undefined : end)
}

function coreFunction(): string {
  const src = readFileSync(CORE_FILE, 'utf8')
  const start = src.indexOf('export async function confirmActorAlias')
  expect(start, 'confirmActorAlias introuvable dans lib/db/actor-alias-write.ts').toBeGreaterThan(-1)
  return src.slice(start)
}

describe('createCopilotActorAlias — isolation tenant (P4-B.2)', () => {
  it("le schéma d'entrée n'accepte pas d'organizationId — impossible à spoofer depuis le client", () => {
    const src = codeOf(WRAPPER_FILE)
    const schemaStart = src.indexOf('const createActorAliasSchema')
    const schemaEnd = src.indexOf('})', schemaStart) + 2
    const schema = src.slice(schemaStart, schemaEnd)
    expect(schema).not.toMatch(/organizationId|organization_id/)
  })

  it('organizationId vient uniquement de requireSiteAccess, jamais de parsed.data', () => {
    const fn = wrapperFunction()
    expect(fn).toContain('requireSiteAccess(siteId)')
    expect(fn).toContain('organizationId = access.organizationId')
    // La seule autre affectation valable est la déclaration de type ; aucune
    // depuis `parsed.data` ou un champ nommé organizationId côté input.
    expect(fn).not.toMatch(/organizationId\s*=\s*parsed\.data/)
    expect(fn).not.toMatch(/organizationId\s*=\s*rawInput/)
  })

  it('le wrapper transmet organizationId (requireSiteAccess) tel quel au cœur confirmActorAlias', () => {
    const fn = wrapperFunction()
    expect(fn).toContain('confirmActorAlias({')
    expect(fn).toContain('organizationId,')
  })

  it('la cible company est revérifiée avec organization_id = celui transmis par l\'appelant', () => {
    const fn = coreFunction()
    const companyBlock = fn.slice(fn.indexOf("targetKind === 'company'"), fn.indexOf('} else {'))
    expect(companyBlock).toContain(".from('companies')")
    expect(companyBlock).toContain(".eq('organization_id', organizationId)")
  })

  it('la cible contact est revérifiée avec organization_id = celui transmis par l\'appelant', () => {
    const fn = coreFunction()
    const contactBlock = fn.slice(fn.indexOf('} else {'), fn.indexOf("if (!contact)") + 40)
    expect(contactBlock).toContain(".from('company_contacts')")
    expect(contactBlock).toContain(".eq('organization_id', organizationId)")
  })

  it("l'insert écrit organization_id = organizationId (paramètre), jamais un champ transmis par le client", () => {
    const fn = coreFunction()
    const insertBlock = fn.slice(fn.indexOf(".from('actor_alias')\n    .insert("), fn.indexOf('.select(\'id\')\n    .single()'))
    expect(insertBlock).toContain('organization_id: organizationId,')
  })

  it('confirmActorAlias ne fait aucune résolution d\'accès elle-même — organizationId est un paramètre requis, pas dérivé', () => {
    const fn = coreFunction()
    expect(fn).not.toContain('requireSiteAccess')
    expect(fn).not.toContain('createClient(')
  })
})
