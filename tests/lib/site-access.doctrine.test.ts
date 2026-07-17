import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── L'ISOLATION EST UN INVARIANT, PAS UNE CONVENTION ─────────────────────────
// « L'isolation multi-tenant doit être un invariant, pas une convention. »
// (Vincent, 2026-07-17)
//
// Constaté dans un navigateur : un conducteur de l'org démo affichait « Lycée
// PETRO ATTITI » — nom, statistiques, carte des captures — alors que ce chantier
// appartient à une AUTRE organisation. Les pages lisaient le chantier avec
// createAdminClient(), qui porte le service role et BYPASSE la RLS. Sans filtre
// dans le code, changer l'UUID de l'URL suffisait.
//
// Seul le panneau Mémoire était vide, parce qu'il filtrait par org. Il avait
// raison tout seul ; c'étaient les pages qui étaient nues.
//
// Ce test échoue AVANT qu'une nouvelle page de chantier ne naisse sans garde.
// (Cf. [[isolation-tenants-fail-closed]].)

const SITE_PAGES_ROOT = join(process.cwd(), 'app/(field)/m/site/[siteId]')

/** Le CODE seul : un commentaire qui explique la faute d'origine ne doit pas
 *  faire échouer le test qui l'interdit. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function findPages(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...findPages(full))
    else if (entry === 'page.tsx') out.push(full)
  }
  return out
}

describe('Chantier — aucune page ne s’ouvre sans garde d’appartenance', () => {
  const pages = findPages(SITE_PAGES_ROOT)

  it('trouve bien les pages de chantier (le test lui-même doit rester branché)', () => {
    expect(pages.length).toBeGreaterThanOrEqual(7)
  })

  it.each(pages.map((p) => [p.slice(SITE_PAGES_ROOT.length).replace(/\\/g, '/'), p]))(
    'la page %s exige requireSiteAccess',
    (_label, path) => {
      const src = readFileSync(path, 'utf8')
      expect(
        src,
        `Cette page lit un chantier sans vérifier qu'il appartient à l'organisation du conducteur. ` +
          `createAdminClient() bypasse la RLS : sans requireSiteAccess(siteId), changer l'UUID de l'URL ` +
          `ouvre le chantier d'un autre client.`,
      ).toContain('requireSiteAccess(siteId)')
    },
  )

  it('la garde rend 404, jamais 403 : un chantier interdit doit être indiscernable d’un inexistant', () => {
    // Dire « accès refusé » confirmerait l'EXISTENCE du chantier à quelqu'un qui
    // n'a pas à savoir qu'il existe.
    const src = codeOf(join(process.cwd(), 'lib/field/site-access.ts'))
    expect(src).toContain('notFound()')
    expect(src).not.toMatch(/403|forbidden|Accès refusé/i)
  })

  it('la garde passe par requireOwned — pas par une comparaison d’org réécrite à la main', () => {
    // Deux implémentations de l'appartenance = deux verdicts possibles, et c'est
    // le plus permissif qui gagnera un jour.
    const src = codeOf(join(process.cwd(), 'lib/field/site-access.ts'))
    expect(src).toContain('requireOwned')
    expect(src).not.toMatch(/\.from\(['"]sites['"]\)/)
  })
})
