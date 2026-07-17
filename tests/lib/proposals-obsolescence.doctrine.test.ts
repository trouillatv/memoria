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
  // LA RÈGLE N'A PAS CHANGÉ — son lieu, si. Elle vivait dans le renderer, qui
  // filtrait `s !== 'superseded'` sur le grand livre. Elle vit maintenant dans le
  // READ MODEL : `getVisitSummary` ne lit que `status = 'proposed'`, donc une
  // lecture périmée n'atteint AUCUN écran. C'est plus fort qu'avant : un seul
  // renderer filtrait, et le PDF — qui lisait le JSON — ne filtrait rien.
  //
  // Ce test avait raison de crier quand le filtre a disparu. Il vérifiait une
  // implémentation là où il fallait garantir un comportement ; on le remonte.

  /** Le CODE seul : un commentaire qui EXPLIQUE la règle ne doit pas la
   *  déclencher. (Erreur commise trois fois dans la journée.) */
  const code = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('le read model ne remonte QUE les propositions vivantes', () => {
    const summary = code('lib/knowledge/visit-summary.ts')
    expect(summary).toContain("eq('status', 'proposed')")
    expect(summary, 'une lecture périmée ne doit jamais sortir du read model')
      .not.toContain("'superseded'")
  })

  it('aucun renderer n’a besoin de filtrer : ils ne reçoivent que du vivant', () => {
    for (const rel of [
      'app/(field)/m/visite/[reportId]/cr/MemoriaRetained.tsx',
      'lib/pdf/visit-cr.tsx',
    ]) {
      expect(code(rel), `${rel} ne doit plus connaître 'superseded' : le read model l'a déjà exclu`)
        .not.toContain("'superseded'")
    }
  })

  it('le Travail non plus ne propose pas de confirmer du périmé', () => {
    const pending = readFileSync(join(process.cwd(), 'lib/knowledge/pending-work.ts'), 'utf8')
    expect(pending).toContain("eq('status', 'proposed')")
  })
})
