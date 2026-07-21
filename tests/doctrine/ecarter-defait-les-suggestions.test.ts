import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ── G4 — TROIS NIVEAUX, ET ILS NE SE VALENT PAS ─────────────────────────────
//
//   Capture            → réversible, c'est de la matière
//   Proposition IA     → réversible, c'est une lecture de cette matière
//   Objet du chantier  → définitif jusqu'à un geste humain
//
// Écarter une capture agit sur les deux premiers. JAMAIS sur le troisième :
// une action créée appartient au chantier, pas à la visite qui l'a suggérée.
//
// Ces tests lisent le code parce que la règle est une garantie de suppression :
// elle doit rester impossible à élargir par inadvertance.

const SRC = fs.readFileSync(path.join(process.cwd(), 'lib/visits/discard-effects.ts'), 'utf8')
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('Écarter une capture retire les propositions non validées', () => {
  it('supprime dans `site_report_proposals`, et nulle part ailleurs', () => {
    const tables = [...code.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1])
    const supprimees = code.includes('.delete()')
    expect(supprimees).toBe(true)
    expect(new Set(tables)).toEqual(new Set(['site_report_proposals', 'site_reports']))
  })

  it('ne supprime QUE les propositions au statut « proposed »', () => {
    expect(code).toMatch(/\.delete\(\)[\s\S]{0,200}\.eq\('status', 'proposed'\)/)
  })

  it('ne touche à AUCUNE table d’objets du chantier', () => {
    for (const table of ['site_actions', 'site_reserve', 'site_deadlines', 'site_decisions', 'captured_knowledge', 'site_intervenants']) {
      expect(code).not.toContain(table)
    }
  })

  it('invalide l’analyse pour que la suivante recalcule depuis ce qui reste', () => {
    expect(code).toContain('debrief_analysis: null')
  })

  it('ne réécrit jamais le compte-rendu humain', () => {
    expect(code).not.toContain('report_documents')
    expect(code).not.toContain('sections')
  })
})

describe('Le geste de tri déclenche la règle — et lui seul', () => {
  const ACTION = fs.readFileSync(
    path.join(process.cwd(), 'app/(field)/m/visite/[reportId]/debrief-actions.ts'),
    'utf8',
  )

  it('ne se déclenche que sur une décision qui écarte', () => {
    expect(ACTION).toMatch(/status === 'discarded'[\s\S]{0,600}undoSuggestionsAfterDiscard/)
  })

  it('ne fait jamais échouer le tri lui-même', () => {
    expect(ACTION).toMatch(/undoSuggestionsAfterDiscard\([\s\S]{0,40}\.catch/)
  })
})
