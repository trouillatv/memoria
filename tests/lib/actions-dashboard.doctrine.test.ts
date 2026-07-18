import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Pilotage des actions (Tranche 1) — invariants du read model serveur ──────
// getActionsDashboard est `server-only` (DB) → on protège ses invariants par
// lecture de source. Aucun nouveau modèle métier : « à confirmer » vient des
// propositions, origine/activité des read models canoniques.

const src = readFileSync(join(process.cwd(), 'lib/knowledge/actions-dashboard.ts'), 'utf8')

describe('getActionsDashboard — fail-closed, groundé, sans invention', () => {
  it('scope org (le service-role bypasse la RLS) sur sites ET propositions', () => {
    expect(src).toContain('getOrgId')
    expect(src).toMatch(/from\('sites'\)[\s\S]*?eq\('organization_id', orgId\)/)
    expect(src).toMatch(/site_knowledge_proposals[\s\S]*?eq\('organization_id', orgId\)/)
  })

  it('« À confirmer » = propositions kind=action encore proposées, JAMAIS un statut de site_actions ni created_from', () => {
    expect(src).toContain("site_knowledge_proposals")
    expect(src).toMatch(/eq\('status', 'proposed'\)/)
    expect(src).toContain('propByKind.action')
    // pas de faux statut de proposition dérivé de l'action elle-même
    expect(src).not.toContain('created_from')
  })

  it('origine = provenance canonique (Slice 5), sources scopées au chantier', () => {
    expect(src).toContain('primaryProvenanceKind')
    expect(src).toMatch(/site_reserve[\s\S]*?in\('site_id', siteIds\)/)
    expect(src).toMatch(/subjects[\s\S]*?in\('site_id', siteIds\)/)
    expect(src).toMatch(/site_reports[\s\S]*?in\('site_id', siteIds\)/)
  })

  it('dernière activité = journal canonique (Slice 6B), pas un 2ᵉ système d’historique', () => {
    expect(src).toContain('site_action_events')
    expect(src).toContain('normalizeActionHistory')
    // activity_logs (log générique) n'est pas utilisé ici
    expect(src).not.toContain('activity_logs')
  })

  it('responsable = personne réelle (contact), jamais une entreprise inventée', () => {
    expect(src).toContain('company_contacts')
    expect(src).toContain('assigned_to') // repli texte
  })

  it('aucun modèle hors-tranche : ni priorité, ni relance', () => {
    expect(src).not.toMatch(/priorit/i)
    expect(src).not.toMatch(/relance|reminder/i)
  })

  it('« terminées sans preuve » = trace de clôture réelle (Slice 7)', () => {
    expect(src).toMatch(/completed_photo_path \|\| a\.completed_comment/)
  })
})
