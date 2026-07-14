import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * DÉPOSER SUR UN JOUR FERMÉ : AVERTIR, JAMAIS BLOQUER.
 *
 * Guillaume : « avertir lors d'un drag vers un jour fermé sans bloquer l'action ».
 *
 * Les deux moitiés de la phrase comptent.
 *
 * BLOQUER serait faux : le chantier décide, pas l'outil. On maintient parfois une
 * prestation un jour de fermeture — c'est même l'un des cinq gestes de résolution
 * déjà livrés (« Maintenir malgré la fermeture »).
 *
 * Mais NE RIEN DIRE était faux aussi : le geste réussissait en silence, et le
 * conflit n'apparaissait qu'au rendu suivant. L'utilisateur créait un problème
 * sans le savoir, et le découvrait après coup.
 *
 * On avertit AU MOMENT du geste, et on laisse faire.
 */

const CLIENT = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', '(planning)', 'semaine', 'WeekGridClient.tsx'),
  'utf8',
)
const CELL = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', '(planning)', 'semaine', 'WeekGridCell.tsx'),
  'utf8',
)

describe('Un dépôt sur un jour fermé', () => {
  it('AVERTIT au moment du geste', () => {
    expect(CLIENT).toContain('closuresBySite')
    expect(CLIENT).toMatch(/toast\.warning\(/)
    expect(CLIENT).toContain('un jour fermé')
  })

  it("dit POURQUOI le chantier est fermé — un avertissement sans motif ne sert à rien", () => {
    expect(CLIENT).toContain('CLOSURE_REASON_FR')
  })

  it("laisse l'utilisateur décider, et le dit", () => {
    expect(CLIENT).toContain('à vous de décider')
  })

  it("n'est JAMAIS bloqué : la cellule fermée reste une cible de dépôt", () => {
    // Le seul dépôt interdit est celui vers le PASSÉ. Une fermeture n'a jamais
    // désactivé la cellule, et ne doit pas commencer.
    expect(CELL).toMatch(/disabled:\s*isPast/)
    expect(CELL).not.toMatch(/disabled:\s*[^,\n]*closure/)
  })
})
