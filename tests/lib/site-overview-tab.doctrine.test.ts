import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── DOCTRINE : des moteurs gelés nommément listés, jamais une lecture directe ──
// Lot 2 « Aujourd'hui » (mandat Vincent) recompose délibérément TROIS moteurs déjà
// gelés (À surveiller / MemorIA a besoin de toi / Points qui traînent) plutôt que de
// les fusionner dans un seul read model : chaque bloc reste la vérité déjà validée de
// sa propre surface (Attention, NeedsYou, Points Lot 1). Le garde-fou n'est donc plus
// « un seul import connaissance », mais une LISTE FERMÉE et nommée de moteurs — toute
// lecture métier directe (lib/db/*, Supabase, projection, repository) reste interdite,
// et tout import connaissance hors de cette liste doit être une décision explicite,
// pas un contournement silencieux.

const TAB = join(process.cwd(), 'app/(dashboard)/sites/[id]/views/apercu/SiteOverviewTab.tsx')
const MOBILE = join(process.cwd(), 'app/(field)/m/site/[siteId]/page.tsx')

function importedModules(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
}

function forbiddenDirectReads(imports: string[]): string[] {
  return imports.filter((mod) =>
    mod.startsWith('@/lib/db/')
    || mod.includes('supabase')
    || mod === '@/lib/knowledge/projection'
    || mod === '@/lib/knowledge/repository',
  )
}

const ALLOWED_TAB_KNOWLEDGE = [
  '@/lib/knowledge/canonical-attention',
  '@/lib/knowledge/tracked-point-read-model',
  '@/lib/knowledge/tracked-point-needs-you-summary',
  '@/lib/knowledge/tracked-point-lingering',
  '@/lib/knowledge/site-today-synthesis',
  '@/lib/knowledge/site-activity',
].sort()

describe('SiteOverviewTab — doctrine des moteurs gelés (Lot 2 « Aujourd\'hui »)', () => {
  const source = readFileSync(TAB, 'utf8')
  const imports = importedModules(source)

  it('ne lit aucune donnée métier en direct', () => {
    const forbidden = forbiddenDirectReads(imports)
    expect(forbidden, `Imports interdits dans Aujourd'hui : ${forbidden.join(', ')}`).toEqual([])
  })

  it('ne compose que les moteurs gelés nommément autorisés', () => {
    const knowledge = imports.filter((mod) => mod.startsWith('@/lib/knowledge/')).sort()
    expect(knowledge).toEqual(ALLOWED_TAB_KNOWLEDGE)
  })

  it('ne construit aucune requête Supabase', () => {
    expect(source).not.toMatch(/createAdminClient|createClient|\.from\(/)
  })
})

// ── DOCTRINE : la fiche mobile compose les MÊMES moteurs que le desktop ───────
// La fiche mobile porte en plus du « ici et maintenant » terrain lu en direct (visite
// en cours, captures, présence, panier) : elle ne passe donc pas la doctrine complète
// de l'onglet desktop. En revanche les trois blocs Lot 2 (« À surveiller », « MemorIA a
// besoin de toi », « Points qui traînent ») doivent venir des MÊMES moteurs gelés que le
// desktop, jamais d'une lecture recomposée localement — sinon les deux surfaces
// affichent deux vérités différentes du même chantier.
const ALLOWED_MOBILE_KNOWLEDGE = [
  '@/lib/knowledge/canonical-attention',
  '@/lib/knowledge/tracked-point-read-model',
  '@/lib/knowledge/tracked-point-needs-you-summary',
  '@/lib/knowledge/tracked-point-lingering',
  '@/lib/knowledge/tracked-point-verify-eligibility',
  '@/lib/knowledge/site-today-synthesis',
  '@/lib/knowledge/site-activity',
].sort()

describe('Fiche mobile — Lot 2 « Aujourd\'hui » consomme les mêmes moteurs gelés', () => {
  const source = readFileSync(MOBILE, 'utf8')
  const imports = importedModules(source)

  it('ne compose que les moteurs gelés nommément autorisés', () => {
    const knowledge = imports.filter((mod) => mod.startsWith('@/lib/knowledge/')).sort()
    expect(knowledge, 'La fiche mobile doit consommer les mêmes moteurs Lot 2 que le desktop, jamais une lecture recomposée localement')
      .toEqual(ALLOWED_MOBILE_KNOWLEDGE)
  })
})
