import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── P5-F2a — LE CR EST FIGÉ, LE CYCLE DE VIE NE LE TOUCHE PAS ────────────────
// Archiver ou superséder une `site_knowledge_entries` change ce que la Mémoire
// COURANTE affiche (`listKnowledgeEntries` filtre déjà sur `status='active'`).
// Un compte-rendu déjà rédigé ne doit JAMAIS changer de contenu après coup : le
// jour où quelqu'un archive une information, les CR passés qui la mentionnaient
// doivent rester ce qu'ils étaient au moment de la visite.
//
// Ce test protège deux lectures précises contre un filtre `status` bien
// intentionné mais faux :
//  - lib/knowledge/visit-summary.ts (le résumé d'UN CR)
//  - readMaterializedCountsByReport (les compteurs affichés PAR CR)
//
// Méthode (règle du projet) : écrire le test, casser le code (ajouter
// `.eq('status', 'active')` sur la lecture des site_knowledge_entries dans ces
// deux fichiers), vérifier qu'il échoue, et seulement alors lui faire confiance.

function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('Le cycle de vie d’une connaissance ne réécrit jamais un CR passé', () => {
  it('visit-summary.ts ne filtre pas site_knowledge_entries par status', () => {
    const src = codeOf('lib/knowledge/visit-summary.ts')
    // La lecture des connaissances du CR ne doit porter aucun filtre `status` —
    // ni 'active', ni son exclusion. Un CR raconte ce qui a été dit, pas ce
    // qu'un humain a archivé ou remplacé depuis.
    const m = src.match(/db\.from\(['"]site_knowledge_entries['"]\)[^\n]*/)
    expect(m, 'visit-summary.ts doit lire site_knowledge_entries').not.toBeNull()
    const line = m ? m[0] : ''
    expect(line, 'aucun filtre status sur la lecture CR des connaissances').not.toMatch(/\.eq\(\s*['"]status['"]/)
    expect(line, 'aucun filtre status sur la lecture CR des connaissances').not.toMatch(/\.neq\(\s*['"]status['"]/)
    expect(line, 'aucun filtre status sur la lecture CR des connaissances').not.toMatch(/\.in\(\s*['"]status['"]/)
  })

  it('readMaterializedCountsByReport ne filtre pas site_knowledge_entries par status', () => {
    const src = codeOf('lib/knowledge/repository.ts')
    const m = src.match(/db\.from\(['"]site_knowledge_entries['"]\)[^\n]*/)
    expect(m, 'la requête site_knowledge_entries doit exister dans repository.ts').not.toBeNull()
    const line = m ? m[0] : ''
    expect(line, 'le compteur par CR ne doit pas exclure les entrées archivées/supersédées').not.toMatch(/\.eq\(\s*['"]status['"]/)
    expect(line, 'le compteur par CR ne doit pas exclure les entrées archivées/supersédées').not.toMatch(/\.neq\(\s*['"]status['"]/)
    expect(line, 'le compteur par CR ne doit pas exclure les entrées archivées/supersédées').not.toMatch(/\.in\(\s*['"]status['"]/)
  })

  it('archiveKnowledgeEntry et supersedeKnowledgeEntry n’invoquent jamais un cron ou un TTL', () => {
    // Rien dans lib/db/site-memory-entries.ts ne doit calculer un âge ou une
    // expiration : le seul déclencheur légitime est un geste humain explicite.
    const src = codeOf('lib/db/site-memory-entries.ts')
    expect(src).not.toMatch(/setInterval|setTimeout|cron|Date\.now\(\)\s*-/)
  })
})
