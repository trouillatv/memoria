import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── UN COMPTEUR COMPTE LA COLLECTION, PAS LA LISTE AFFICHÉE ─────────────────
//
// Le brief chantier tronque volontairement ce qu'il AFFICHE : `openReserves`
// s'arrête à 6 réserves, `deadlineItems` à 8 échéances. C'est un choix de
// lisibilité légitime.
//
// Ce qui ne l'est pas : compter sur ces listes tronquées. Un chantier à dix
// réserves ouvertes annonçait « 6 réserves ouvertes » — un nombre présenté comme
// un fait métier alors qu'il ne décrivait qu'une limite d'affichage.
//
// Les collections complètes (`reserves`, `deadlineRows`) sont déjà en mémoire :
// compter dessus ne coûte aucune requête. Ce garde-fou interdit le retour en
// arrière.

const BRIEF = 'app/(dashboard)/sites/[id]/site-brief-actions.ts'
const src = readFileSync(join(process.cwd(), BRIEF), 'utf8')
const confirmedFacts = src.slice(
  src.indexOf('const confirmedFacts: SiteBriefFactLine[] = ['),
  src.indexOf('const freshness = getPreparationFreshness'),
)

describe('Compteurs du brief chantier', () => {
  it('le bloc confirmedFacts existe et a bien été localisé', () => {
    expect(confirmedFacts).toContain('réserve')
    expect(confirmedFacts.length).toBeGreaterThan(200)
  })

  it('ne compte jamais sur les listes tronquées pour l’affichage', () => {
    // `openReserves` = slice(0, 6), `deadlineItems` = slice(0, 8) : ces deux
    // tableaux existent pour être RENDUS, jamais pour être comptés.
    expect(confirmedFacts).not.toMatch(/openReserves\.length/)
    expect(confirmedFacts).not.toMatch(/deadlineItems\.filter/)
  })

  it('compte sur les collections complètes déjà chargées', () => {
    expect(src).toMatch(/const allOpenReserves = reserves\.filter/)
    expect(src).toMatch(/const allDeadlinesToPlan = deadlineRows\.filter/)
    expect(confirmedFacts).toMatch(/allOpenReserves\.length/)
    expect(confirmedFacts).toMatch(/allDeadlinesToPlan\.length/)
  })

  it('chaque compteur dit ce qu’il compte et ouvre sur ses objets', () => {
    const definitions = [...confirmedFacts.matchAll(/itemsDefinition:/g)]
    const drilldowns = [...confirmedFacts.matchAll(/\.\.\.drilldown\(/g)]
    expect(definitions.length, 'chaque compteur doit expliciter son périmètre').toBe(3)
    expect(drilldowns.length, 'chaque compteur doit pouvoir s’ouvrir sur ses objets').toBe(3)
  })

  it('le drill-down annonce ce qu’il n’affiche pas', () => {
    // Tronquer en silence se lit comme « voici tout » : le reste doit être compté.
    expect(src).toMatch(/itemsHiddenCount: Math\.max\(0, rows\.length - DRILLDOWN_MAX\)/)
  })
})
