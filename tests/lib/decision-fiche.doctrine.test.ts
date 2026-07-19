import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Fiche Décision — le PIVOT, factuel et fail-closed ────────────────────────
// getSiteDecisionFiche est server-only (DB) → on protège ses invariants par
// lecture de source (même pattern que action-fiche.doctrine).

const src = readFileSync(join(process.cwd(), 'lib/knowledge/decision-fiche.ts'), 'utf8')

describe('getSiteDecisionFiche — factuel, jamais inventé', () => {
  it('fail-closed org + scope chantier', () => {
    expect(src).toContain('getOrgId')
    expect(src).toContain('organization_id')
    expect(src).toContain('getSiteDecision(siteId, decisionId)')
  })

  it('« en vigueur » est STRICTEMENT dérivé du statut — jamais un champ inventé', () => {
    expect(src).toMatch(/EN_VIGUEUR\s*=\s*new Set/)
    expect(src).toContain('EN_VIGUEUR.has(d.statut)')
    expect(src).toContain('vigueurLabel: VIGUEUR[d.statut]')
  })

  it('impact = CATÉGORIE (IMPACT_LABEL), le récit vient de description (un seul texte)', () => {
    expect(src).toMatch(/impactLabel: d\.impact \? IMPACT_LABEL\[d\.impact\]/)
    expect(src).toContain('description: d.description')
  })

  it('statut affiché = COURANT (STATUT_LABEL) — pas de fausse transition (aucun journal de décision)', () => {
    expect(src).toContain('statutLabel: STATUT_LABEL[d.statut]')
    expect(src).not.toContain('site_decision_events')
  })

  it('décideur cliquable UNIQUEMENT si au casting (site_intervenants), sinon href null', () => {
    expect(src).toMatch(/from\('site_intervenants'\)[\s\S]*?eq\('main_contact_id', d\.decisionnaireContactId\)/)
    expect(src).toMatch(/href: interId \? .* : null/)
  })

  it('réunion = provenance scopée ; action liée = conséquence scopée (garde IDOR)', () => {
    expect(src).toMatch(/from\('site_reports'\)[\s\S]*?eq\('site_id', siteId\)/)
    expect(src).toMatch(/from\('site_actions'\)[\s\S]*?eq\('site_id', siteId\)/)
    expect(src).toContain('d.actionId')
  })
})
