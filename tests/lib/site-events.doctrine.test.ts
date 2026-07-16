import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── DOCTRINE : l'accueil et la fiche disent le MÊME nombre ───────────────────
// « Dashboard → SiteOverview → Projection. Jamais Dashboard → SQL. » (Vincent)
//
// Si l'accueil recompte les propositions lui-même, il dira « 2 » le jour où la
// fiche dira « 3 » — et le conducteur ne croira plus aucun des deux. Le read model
// du jour n'a le droit de DÉCOUVRIR que ceci : quels chantiers ont bougé, et quand.
// Les nombres, il les lit dans getSiteOverview.
//
// Ce test échoue AVANT que le raccourci n'existe.

const TODAY = join(process.cwd(), 'lib/knowledge/site-events.ts')
const CARD = join(process.cwd(), 'app/(dashboard)/dashboard/VisitImpactCard.tsx')

function imports(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
}

describe('getVisitImpact — doctrine du nombre unique', () => {
  const source = readFileSync(TODAY, 'utf8')

  it('ne touche jamais Supabase directement', () => {
    expect(source).not.toMatch(/createAdminClient|createClient|\.from\(/)
    expect(imports(source).filter((m) => m.includes('supabase'))).toEqual([])
  })

  it('lit les nombres via le read model de la fiche chantier', () => {
    expect(source).toContain('getSiteOverview')
  })

  it('ne rebranche pas un compteur parallèle de propositions', () => {
    // countProposedActionsForSites compte via le repository, pas via la projection :
    // deux chemins, deux vérités possibles. L'accueil ne doit pas l'utiliser.
    expect(source).not.toContain('countProposedActionsForSites')
  })
})

// ── LE PIÈGE DU KIND ────────────────────────────────────────────────────────
// La base ne connaît QUE ces six kinds (migration 212) : 'vigilance' — jamais
// 'watchpoint'. Le TypeScript, lui, appelle le champ `watchpoints` (projection.ts
// fait la traduction). Le jour où on lit la base avec le mot du TypeScript, le
// filtre ne matche rien : les points de vigilance d'une visite disparaissent
// SANS erreur — la frise dit « rien retenu » d'une visite qui en a relevé trois.
// C'est arrivé. Ce test tient la frontière.
describe('Le kind vient de la base, pas du TypeScript', () => {
  const source = readFileSync(TODAY, 'utf8')

  it("ne compare jamais un proposal_kind à 'watchpoint'", () => {
    expect(source).not.toMatch(/proposal_kind === 'watchpoint'|countKind\([^)]*'watchpoint'\)/)
    expect(source).not.toMatch(/case 'watchpoint':/)
  })

  it("connaît le vrai kind 'vigilance'", () => {
    expect(source).toContain("'vigilance'")
  })
})

describe("La carte d'impact — ne lit rien elle-même", () => {
  const source = readFileSync(CARD, 'utf8')

  it('ne connaît que le read model du jour', () => {
    const forbidden = imports(source).filter((m) => m.startsWith('@/lib/db/') || m.includes('supabase'))
    expect(forbidden, `Imports interdits : ${forbidden.join(', ')}`).toEqual([])
  })
})
