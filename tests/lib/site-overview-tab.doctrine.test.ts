import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── DOCTRINE : un onglet, un read model ──────────────────────────────────────
// L'onglet Aperçu ne peut lire QUE `getSiteOverview`. Toute lecture métier directe
// (lib/db/*, Supabase, projection, repository) contournerait le read model : la
// fiche recommencerait à composer ses données elle-même, et deux écrans finiraient
// par afficher deux vérités différentes du même chantier.
//
// Si une donnée manque à l'Aperçu, elle entre dans SiteOverview — pas ici.
// Ce test est le garde-fou : il échoue AVANT que le contournement n'existe.

const TAB = join(process.cwd(), 'app/(dashboard)/sites/[id]/views/apercu/SiteOverviewTab.tsx')

function importedModules(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
}

describe('SiteOverviewTab — doctrine du read model', () => {
  const source = readFileSync(TAB, 'utf8')
  const imports = importedModules(source)

  it('ne lit aucune donnée métier en direct', () => {
    const forbidden = imports.filter((mod) =>
      mod.startsWith('@/lib/db/')
      || mod.includes('supabase')
      || mod === '@/lib/knowledge/projection'
      || mod === '@/lib/knowledge/repository',
    )
    expect(forbidden, `Imports interdits dans l'Aperçu : ${forbidden.join(', ')}`).toEqual([])
  })

  it('ne connaît de la couche connaissance que le read model', () => {
    const knowledge = imports.filter((mod) => mod.startsWith('@/lib/knowledge/'))
    expect(knowledge).toEqual(['@/lib/knowledge/site-overview'])
  })

  it('ne construit aucune requête Supabase', () => {
    expect(source).not.toMatch(/createAdminClient|createClient|\.from\(/)
  })
})
