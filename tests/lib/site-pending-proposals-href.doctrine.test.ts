import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── P0-B — les propositions à confirmer mènent à la surface d'arbitrage ──────
// Audit READ-ONLY (debrief-d3-recette-audit-parcours-action) : reportHref
// pointait vers la visite générique, qui n'a AUCUN CTA confirmer/écarter.
// Le mécanisme existe et fonctionne sur /compte-rendu (PanneauArbitrage,
// promoteActionProposalAction/dismissActionProposalAction). Une ligne à
// corriger, pas un nouveau mécanisme (pas de duplication dans FactLedgerView).

const src = readFileSync(join(process.cwd(), 'lib/knowledge/site-pending-proposals.ts'), 'utf8')

describe('getSitePendingActionProposals — reportHref mène à l’arbitrage réel', () => {
  it('pointe vers /compte-rendu, pas la visite générique sans CTA', () => {
    expect(src).toContain('reportHref: r.report_id ? `/sites/${siteId}/visites/${r.report_id}/compte-rendu` : null')
  })

  it('ne pointe plus vers la visite nue (régression du bug audité)', () => {
    // La seule occurrence du gabarit `/visites/${r.report_id}` doit être suivie
    // de `/compte-rendu` — jamais la forme nue qui n'a aucun CTA.
    expect(src).not.toContain('`/sites/${siteId}/visites/${r.report_id}`')
  })
})
