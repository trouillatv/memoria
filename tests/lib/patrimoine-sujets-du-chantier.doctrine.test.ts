// Patrimoine — « Sujets du chantier » = sujets MÉTIER seuls (audit UX 2026-09-01, Option A).
//
// Le bloc lisait canonical_subject sans filtre kind → il listait les intervenants
// (kind='actor') comme s'ils étaient des sujets (9 acteurs + 1 sujet sur BELLA).
// Les intervenants ont déjà leur place (« Ce que MemorIA sait » via site_intervenants,
// et le Suivi « Intervenants ») ; Patrimoine ne doit montrer ici que les sujets
// métier. Ces assertions figent : le bloc filtre kind='business_subject', et le
// titre n'est plus « Sujets suivis » (qui prêtait à confusion avec le Suivi).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = join(process.cwd(), 'app/(field)/m/site/[siteId]/(chantier)/patrimoine/page.tsx')
const src = readFileSync(SOURCE, 'utf8')

describe('Patrimoine — bloc « Sujets du chantier »', () => {
  it('le bloc canonical_subject filtre sur kind=business_subject (intervenants exclus)', () => {
    // La requête doit porter le filtre métier, à proximité de la lecture canonical_subject.
    const block = src.slice(src.indexOf("from('canonical_subject')"))
    expect(block).toContain("from('canonical_subject')")
    expect(block).toContain(".eq('kind', 'business_subject')")
  })

  it('la section s’intitule « Sujets du chantier », plus « Sujets suivis »', () => {
    expect(src).toContain('Sujets du chantier')
    expect(src, '« Sujets suivis » prêtait à confusion avec le Suivi et mélangeait les acteurs')
      .not.toContain('>Sujets suivis<')
  })
})
