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

const TODAY = join(process.cwd(), 'lib/knowledge/today-changes.ts')
const CARD = join(process.cwd(), 'app/(dashboard)/dashboard/TodayChangesCard.tsx')

function imports(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
}

describe('getTodayChanges — doctrine du nombre unique', () => {
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

describe('TodayChangesCard — ne lit rien elle-même', () => {
  const source = readFileSync(CARD, 'utf8')

  it('ne connaît que le read model du jour', () => {
    const forbidden = imports(source).filter((m) => m.startsWith('@/lib/db/') || m.includes('supabase'))
    expect(forbidden, `Imports interdits : ${forbidden.join(', ')}`).toEqual([])
  })
})
