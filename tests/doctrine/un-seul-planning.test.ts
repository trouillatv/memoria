import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UN SEUL PLANNING. UN SEUL MOTEUR. UNE SEULE GRILLE.
 *
 * Guillaume ne dit jamais « je vais dans la vue Mois ». Il dit « montre-moi mon
 * planning », puis il zoome.
 *
 * La grille de la semaine est l'écran VIVANT : glisser-déposer, conflits,
 * fermetures, mémoire du lieu, tiroir. Le mois ne doit pas être une seconde
 * grille écrite à côté — ce serait un second produit, et deux tableaux parallèles
 * finissent toujours par diverger.
 *
 * Ce test tient la trajectoire pendant le chantier : le noyau est commun, la
 * semaine n'est plus qu'un point d'entrée, et l'échelle ne change QUE la densité.
 */

const GRID = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', '(planning)', 'semaine', 'WeekGrid.tsx'),
  'utf8',
)
const LOADER = readFileSync(join(process.cwd(), 'lib', 'db', 'week-planning.ts'), 'utf8')

describe('La grille du planning', () => {
  it('est UNE grille, paramétrée par une échelle', () => {
    expect(GRID).toContain('export function PlanningGrid')
    expect(GRID).toMatch(/scale\??:\s*PlanningScale/)
  })

  it("fait de la semaine un simple point d'entrée", () => {
    expect(GRID).toMatch(/<PlanningGrid scale="week"/)
  })

  it('tire ses colonnes de la PLAGE, pas d’un compteur figé à sept', () => {
    expect(GRID).toContain('enumerateRangeDays')
    expect(GRID).not.toMatch(/for \(let i = 0; i < 7; i\+\+\)/)
  })

  it('déduit le jour de la DATE, jamais de sa position', () => {
    // `DAY_LABELS_SHORT[i]` cassait dès qu'il y avait plus de sept colonnes.
    expect(GRID).toContain('weekdayShortFr')
    expect(GRID).not.toContain('DAY_LABELS_SHORT')
  })
})

describe('Le chargeur de données', () => {
  it('est borné par la plage — sept jours ou trente-et-un, même code', () => {
    expect(LOADER).toContain('enumerateRangeDays')
    // L'ancien verrou : sept jours comptés depuis le lundi, `weekEnd` ignoré.
    expect(LOADER).not.toMatch(/for \(let i = 0; i < 7; i\+\+\)/)
  })

  it('reste UNE source — pas de second chargeur pour le mois', () => {
    // Le jour où un `listInterventionsForMonth` apparaît, la divergence commence.
    expect(LOADER).not.toContain('listInterventionsForMonth')
  })
})

describe("L'écran de la semaine", () => {
  it('dit « Chantier », le mot de Guillaume — pas « Site », celui de la base', () => {
    // Le renommage (#188) l'avait manqué : le test de vocabulaire ne lisait que
    // le texte JSX tenant sur UNE ligne, et cet en-tête est sur trois.
    expect(GRID).not.toMatch(/>\s*\n\s*Site\s*\n\s*<\/th>/)
    expect(GRID).toMatch(/>\s*\n\s*Chantier\s*\n\s*<\/th>/)
  })
})
