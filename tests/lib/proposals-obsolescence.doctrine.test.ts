import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── DOCTRINE : obsolète ≠ écarté ─────────────────────────────────────────────
// « La visite est la vérité. La synthèse est une lecture de cette vérité. Une
// nouvelle lecture rend l'ancienne obsolète. » (Vincent, 2026-07-17)
//
// Deux propriétés doivent tenir, sinon MemorIA met dans la bouche du conducteur
// des mots qu'il n'a pas dits :
//
//   1. Une décision HUMAINE ne devient jamais obsolète. Confirmée ou écartée, elle
//      est à lui. Seules les propositions encore en attente (`proposed`) peuvent
//      être remplacées par une lecture plus riche.
//   2. Une proposition que la synthèse COURANTE redit est vivante. Seules celles
//      d'une lecture antérieure (`analysis_version` plus ancienne) sont candidates.
//
// Ce test lit le code : il échoue si l'un des deux garde-fous saute.

const SOURCE = readFileSync(join(process.cwd(), 'lib/db/knowledge-proposals.ts'), 'utf8')

function obsolescenceBlock(): string {
  const start = SOURCE.indexOf('async function markObsoleteProposals')
  expect(start, 'markObsoleteProposals a disparu').toBeGreaterThan(-1)
  return SOURCE.slice(start, start + 1400)
}

describe('Obsolescence des propositions', () => {
  it("ne touche QUE les propositions en attente — jamais une décision humaine", () => {
    const block = obsolescenceBlock()
    expect(block).toContain(".eq('status', 'proposed')")
  })

  it("ne touche QUE les lectures antérieures — ce que la synthèse redit reste vivant", () => {
    const block = obsolescenceBlock()
    expect(block).toContain(".lt('analysis_version', version)")
  })

  it("marque « obsolète », jamais « écarté »", () => {
    const block = obsolescenceBlock()
    expect(block).toContain("status: 'superseded'")
    expect(block).not.toContain("status: 'dismissed'")
  })

  it("n'invente pas le lien vers la proposition qui remplace", () => {
    // On sait que la nouvelle lecture ne dit plus ce fait ; on ne sait pas LEQUEL
    // des nouveaux le remplace. Le deviner par ressemblance serait inventer.
    const block = obsolescenceBlock()
    expect(block).not.toContain('superseded_by:')
  })
})

describe("Le compte-rendu ne propose pas de confirmer une lecture périmée", () => {
  const cr = readFileSync(
    join(process.cwd(), 'app/(field)/m/visite/[reportId]/cr/MemoriaRetained.tsx'),
    'utf8',
  )
  it('écarte les propositions obsolètes des actions à confirmer', () => {
    expect(cr).toContain("s !== 'superseded'")
  })
})
