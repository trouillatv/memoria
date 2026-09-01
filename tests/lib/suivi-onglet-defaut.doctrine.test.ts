// Suivi — onglet d'entrée DÉTERMINISTE (audit UX 2026-09-01).
//
// Le défaut « À surveiller » en dur faisait atterrir l'utilisateur sur un onglet
// vide alors que « En mouvement »/« Tout » contenaient des sujets (BELLA) : il
// pouvait croire qu'il n'y avait rien à voir. La règle devient : À surveiller si
// elle a du contenu (signaux d'attention, ou radar premier PV sur chantier jeune),
// sinon En mouvement s'il y en a, sinon Tout. Et l'onglet À surveiller vide montre
// une porte de sortie vers En mouvement — sans agrégat ni compteur.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = join(
  process.cwd(),
  'app/(field)/m/site/[siteId]/(chantier)/sujets/SujetsList.tsx',
)
const src = readFileSync(SOURCE, 'utf8')

describe('Suivi — onglet par défaut', () => {
  it("ne fixe plus « À surveiller » en dur comme onglet d'entrée", () => {
    expect(src, "le défaut en dur 'surveiller' est précisément le bug corrigé")
      .not.toContain("useState<Tab>('surveiller')")
  })

  it('choisit l’onglet d’entrée par la règle surveiller → mouvement → tout', () => {
    // La décision repose sur la présence réelle de contenu dans chaque bucket.
    expect(src).toContain('surveillerHasContent')
    expect(src).toContain('buckets.watch.length > 0')
    expect(src).toContain('buckets.moving.length > 0')
    // L'initialiseur paresseux encode l'échelle de repli mouvement → tout.
    expect(src).toMatch(/useState<Tab>\(\(\)\s*=>/)
    expect(src).toMatch(/'mouvement'\s*:\s*'tout'/)
  })

  it("« À surveiller » a du contenu aussi via le radar d’un chantier jeune (pas de faux vide)", () => {
    expect(src).toContain('isYoungSite && radarSorted.length > 0')
  })

  it('un « À surveiller » vide propose une sortie vers « En mouvement » (sans compteur)', () => {
    expect(src).toContain('Voir les sujets en mouvement')
    expect(src).toContain("setTab('mouvement')")
  })
})
