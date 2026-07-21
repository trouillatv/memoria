import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { canonicalFamily, signatureOf, withConcretisation } from '@/lib/visits/cr-concretisation'
import { classifyProduced, describeLimits } from '@/lib/visits/narrative'
import type { ReportDocumentSection, SectionConcretisation } from '@/types/db'

// ── UN SEUL JOURNAL, DEUX PORTES ────────────────────────────────────────────
//
// La concrétisation du compte-rendu et la promotion d'une proposition mènent
// toutes deux au chantier. Leur donner le même journal ne suffit pas : il faut
// qu'elles s'y RECONNAISSENT. Leurs vocabulaires diffèrent (deadline/echeance,
// knowledge/memoire, stakeholder/intervenant) — sans identité commune, écrire
// au journal laisserait le doublon revenir par la petite porte.

const entree = (kind: string, label: string, id: string): SectionConcretisation => ({
  item_key: `k:${id}`,
  entity_type: canonicalFamily(kind)!,
  entity_id: id,
  created_at: '2026-07-21T06:00:00Z',
  source_text: label,
})

describe('Les deux portes partagent UNE identité', () => {
  it('une « deadline » promue et une « echeance » concrétisée portent la même signature', () => {
    const a = signatureOf({ kind: canonicalFamily('deadline')!, label: 'Passage électricien' })
    const b = signatureOf({ kind: canonicalFamily('echeance')!, label: 'Passage électricien' })
    expect(a).toBe(b)
  })

  it('idem pour knowledge/memoire et stakeholder/intervenant', () => {
    expect(signatureOf({ kind: canonicalFamily('knowledge')!, label: 'Code du cadenas' }))
      .toBe(signatureOf({ kind: canonicalFamily('memoire')!, label: 'Code du cadenas' }))
    expect(signatureOf({ kind: canonicalFamily('stakeholder')!, label: 'Clim Expert' }))
      .toBe(signatureOf({ kind: canonicalFamily('intervenant')!, label: 'Clim Expert' }))
  })

  it('la casse et les espaces ne créent pas deux identités', () => {
    expect(signatureOf({ kind: 'action', label: '  RELANCER Yann ' }))
      .toBe(signatureOf({ kind: 'action', label: 'relancer yann' }))
  })
})

describe('Sens 1 — le compte-rendu d’abord, la proposition ensuite', () => {
  const sections: ReportDocumentSection[] = [
    { key: 'echeances', title: 'Échéances', kind: 'generative', content: '- Passage électricien' },
  ]
  const journal = withConcretisation(sections, 'echeances', entree('echeance', 'Passage électricien', 'dl-1'))

  it('le journal porte l’objet concrétisé', () => {
    expect(journal[0]!.concretisations).toHaveLength(1)
  })

  it('une proposition « deadline » de même libellé s’y reconnaît — pas de jumeau', () => {
    const cherchee = signatureOf({ kind: canonicalFamily('deadline')!, label: 'Passage électricien' })
    const trouvee = (journal[0]!.concretisations ?? []).some(
      (c) => signatureOf({ kind: canonicalFamily(c.entity_type)!, label: c.source_text }) === cherchee,
    )
    expect(trouvee).toBe(true)
  })
})

describe('Sens 2 — la proposition d’abord, le compte-rendu ensuite', () => {
  const sections: ReportDocumentSection[] = [
    { key: 'propositions', title: 'Propositions confirmées', kind: 'fixed', content: '' },
  ]
  const journal = withConcretisation(sections, 'propositions', entree('stakeholder', 'Clim Expert', 'iv-1'))

  it('l’intervenant promu entre au journal — sa provenance existe enfin', () => {
    const [p] = classifyProduced(
      (journal[0]!.concretisations ?? []).map((c) => ({ ...c, sourceSection: 'propositions' })),
      [],
    )
    expect(p).toMatchObject({ kind: 'intervenant', id: 'iv-1', provenance: 'registry' })
  })

  it('une concrétisation ultérieure du même libellé s’y reconnaît', () => {
    const cherchee = signatureOf({ kind: canonicalFamily('intervenant')!, label: 'clim expert' })
    const trouvee = (journal[0]!.concretisations ?? []).some(
      (c) => signatureOf({ kind: canonicalFamily(c.entity_type)!, label: c.source_text }) === cherchee,
    )
    expect(trouvee).toBe(true)
  })
})

describe('« produit » ne lit que le journal', () => {
  it('un objet seulement rattaché n’est pas « produit »', () => {
    expect(classifyProduced([], [{ kind: 'action', id: 'a-9', label: 'Ancienne', createdAt: null }]))
      .toHaveLength(1) // classifyProduced sait encore le faire…
    // …mais le récit ne lui donne plus cette liste : cf. buildVisitNarrative,
    // qui passe [] et compte les rattachements dans les limites.
    const narrative = fs.readFileSync(path.join(process.cwd(), 'lib/db/visit-narrative.ts'), 'utf8')
    expect(narrative).toContain('classifyProduced(registry, [])')
    expect(narrative).toMatch(/historicalAttributions: historical\.length/)
  })

  it('les limites se disent toujours', () => {
    expect(describeLimits([]).intervenantProvenanceMissing).toBe(true)
  })
})

describe('Une obsolescence n’est pas un rejet', () => {
  const narrative = fs.readFileSync(path.join(process.cwd(), 'lib/db/visit-narrative.ts'), 'utf8')

  it('« superseded » est compté à part, jamais avec les écartés', () => {
    expect(narrative).toMatch(/ignoredProposals: understood\.filter\(\(p\) => p\.status === 'dismissed'\)/)
    expect(narrative).toMatch(/supersededProposals: understood\.filter\(\(p\) => p\.status === 'superseded'\)/)
  })

  it('les gestes éditoriaux comptent aussi comme arbitrages humains', () => {
    expect(narrative).toContain('correctedSections,')
    expect(narrative).toContain('discardedCaptures:')
  })
})
