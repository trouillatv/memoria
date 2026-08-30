import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── P0-C1-D — le journal AVANT la proposition ────────────────────────────────
// Témoin Guillaume (audit P0-C : cadenas-sécurisation) : une visite concrétisée
// depuis le CR mobile (`createFromCrAction`) crée l'action directement, sans
// jamais passer par `site_knowledge_proposals`. Une re-synthèse ultérieure du
// débrief (`projectDebriefToProposals`) ne consultait JAMAIS le journal de
// concrétisation avant d'insérer — elle faisait donc renaître une proposition
// 'proposed', jamais refermée, pour un objet déjà réel. Guillaume revoyait une
// action qu'il avait déjà traitée.
//
// `promoteProposal` consultait déjà le journal (findInLedger) avant de créer —
// c'est la porte symétrique qui manquait ici. Le fix réutilise EXACTEMENT la
// même primitive (canonicalFamily/signatureOf/le journal `report_documents.
// sections[].concretisations`), scopée au SEUL report_id de la synthèse : un
// rapprochement structurel (même visite, même signature), jamais lexical
// hors-visite. C'est ce qui garde Bella (AMBIGU, cross-report) hors mécanisme.

const SOURCE = join(process.cwd(), 'lib/db/knowledge-proposals.ts')
const LEDGER_SOURCE = join(process.cwd(), 'lib/db/concretisation-ledger.ts')

function bodyOf(file: string, name: string): string {
  const src = readFileSync(file, 'utf8')
  const start = src.indexOf(`export async function ${name}`)
  expect(start, `${name} est introuvable`).toBeGreaterThan(-1)
  const next = src.indexOf('\nexport ', start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('projectDebriefToProposals — consulte le journal avant d’insérer', () => {
  const fn = bodyOf(SOURCE, 'projectDebriefToProposals')

  it('lit le journal de CE report_id, une seule fois pour toute la synthèse', () => {
    expect(fn).toContain('ledgerSignatures(reportId)')
  })

  it('une nouvelle proposition dont le journal porte déjà l’objet naît fulfilled, jamais proposed', () => {
    const insertBranch = fn.slice(fn.indexOf('if (!ex) {'), fn.indexOf('let status: ProposalStatus'))
    expect(insertBranch).toContain("status: 'fulfilled'")
    expect(insertBranch).toContain('promoted_object_type: ledgerMatch.entity_type')
    expect(insertBranch).toContain('promoted_object_id: ledgerMatch.entity_id')
  })

  it('naître satisfaite ne fabrique jamais un arbitrage humain', () => {
    // reviewed_by / reviewed_at ne sont jamais ÉCRITS (aucune clé d'objet) dans
    // la branche d'insertion fulfilled-par-journal : personne n'a jugé CETTE
    // proposition (même doctrine que fulfillProposalsFromConcretisation, mig 231).
    const insertBranch = fn.slice(fn.indexOf('if (ledgerMatch) {'), fn.indexOf('fulfilledByLedger++') + 20)
    expect(insertBranch).not.toMatch(/reviewed_by:/)
    expect(insertBranch).not.toMatch(/reviewed_at:/)
  })

  it('une proposition déjà proposed que le journal referme ensuite passe à fulfilled, pas un simple rafraîchissement de texte', () => {
    const refreshBranch = fn.slice(fn.indexOf("if (ex.status === 'proposed') {"), fn.indexOf('refreshed++'))
    expect(refreshBranch).toContain("status: 'fulfilled'")
    expect(refreshBranch).toContain(".eq('status', 'proposed')") // garde anti-concurrence
  })

  it('une décision humaine déjà rendue (confirmed/dismissed/superseded/masked) reste hors d’atteinte du journal', () => {
    // Le seul geste sur la branche "sinon" est skipped++ : le journal n'écrit
    // jamais là où un humain a déjà tranché.
    const elseBranch = fn.slice(fn.lastIndexOf('} else {'), fn.lastIndexOf('} else {') + 60)
    expect(elseBranch).toContain('skipped++')
    expect(elseBranch).not.toContain('fulfilled')
  })

  it('une vigilance ne matche jamais le journal — elle raconte, elle ne se concrétise pas', () => {
    expect(fn).toContain('const family = canonicalFamily(d.kind)')
    expect(fn).toContain('if (!family) return null')
  })

  it('la mutation de statut par le journal invalide la projection du chantier', () => {
    expect(fn).toContain('fulfilledByLedger > 0')
  })

  it('le rapprochement reste scopé à un seul report_id — aucun paramètre de tolérance lexicale', () => {
    expect(fn).not.toMatch(/similarity|fuzzy|levenshtein/i)
  })
})

describe('concretisation-ledger — un seul index, deux lecteurs', () => {
  const src = readFileSync(LEDGER_SOURCE, 'utf8')

  it('findInLedger et ledgerSignatures lisent le même document, une seule traversée', () => {
    const findFn = bodyOf(LEDGER_SOURCE, 'findInLedger')
    // findInLedger délègue à l'index batché : pas de traversée dupliquée.
    expect(findFn).toContain('ledgerSignatures(reportId)')
    expect(src).toContain('export async function ledgerSignatures')
  })

  it('ledgerSignatures indexe par signature canonique (famille + libellé), premier gagnant', () => {
    const idxFn = bodyOf(LEDGER_SOURCE, 'ledgerSignatures')
    expect(idxFn).toContain('canonicalFamily(entry.entity_type)')
    expect(idxFn).toContain('signatureOf({ kind: f, label: entry.source_text })')
    expect(idxFn).toContain('if (!map.has(sig))')
  })
})
