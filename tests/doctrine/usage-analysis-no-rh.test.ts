// Garde-fou doctrinal — « Analyse d'usage » par personne (board 2026-06-23).
//
// L'ouverture d'une vue PAR PERSONNE est encadrée : c'est de l'observation
// PRODUIT (où l'on clique, quels menus restent morts), jamais un outil RH.
// Ce test gèle les garde-fous dans le même geste que la feature :
//   1. aucun vocabulaire RH/notation dans les surfaces (hors commentaires) ;
//   2. le helper est scopé à UNE personne (jamais de mise en regard) ;
//   3. la consultation est tracée (tripwire) ;
//   4. la surface est admin-only (gate du layout admin).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf-8')

const PAGE = 'app/admin/personnes/[id]/page.tsx'
const HELPER = 'lib/db/user-journey.ts'
const TABLE = 'app/admin/personnes/PersonnesTable.tsx'
const LAYOUT = 'app/admin/layout.tsx'

// Lignes de code seulement (les commentaires citent volontairement « RH »,
// « temps passé »… pour expliquer ce qui est INTERDIT).
function codeLines(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

// Vocabulaire de dérive RH/notation interdit comme texte affiché.
const FORBIDDEN = [
  /\bperformance\b/i,
  /\bproductivit/i,
  /\bclassement\b/i,
  /\bpalmar[eè]s\b/i,
  /\branking\b/i,
  /\bcomparaison\b/i,
  /\btemps\s+pass[ée]s?\b/i,
  /\bscore\b/i,
  /\bnotation\b/i,
]

describe('Doctrine — analyse d’usage, pas un outil RH', () => {
  it('aucune surface n’emploie de vocabulaire RH/notation', () => {
    for (const f of [PAGE, HELPER, TABLE]) {
      const code = codeLines(read(f))
      for (const re of FORBIDDEN) {
        expect(re.test(code), `Vocabulaire interdit (${re}) dans ${f}`).toBe(false)
      }
    }
  })

  it('le helper est scopé à UNE personne (aucune mise en regard d’autres comptes)', () => {
    const src = read(HELPER)
    expect(src, 'le helper doit filtrer par user_id').toMatch(/\.eq\(\s*['"]user_id['"]/)
  })

  it('la consultation de l’analyse est elle-même tracée (tripwire)', () => {
    const src = read(PAGE)
    expect(src).toMatch(/insertActivityLog/)
    expect(src).toMatch(/usage_analysis_viewed/)
  })

  it('la surface est admin-only (gate du layout admin)', () => {
    const layout = read(LAYOUT)
    expect(layout).toMatch(/role\s*!==\s*['"]admin['"]/)
  })
})
