import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Intervenants = relation racontée par les ENGAGEMENTS structurés ──────────
// (cadrage Vincent 2026-07-19). On branche décisions + obligations dans le read
// model existant, par FK personne, scopés au chantier. Jamais la présence (texte
// libre), jamais les réserves (pas de FK personne).

const src = readFileSync(join(process.cwd(), 'lib/knowledge/site-intervenants-view.ts'), 'utf8')

describe('read model intervenant — engagements structurels', () => {
  it('décisions portées : depuis decisionnaire_contact_id, scopé au chantier', () => {
    expect(src).toMatch(/from\('site_decisions'\)[\s\S]*?eq\('site_id', siteId\)[\s\S]*?in\('decisionnaire_contact_id', activeContactIds\)/)
    expect(src).toContain('decisionsCount')
  })

  it('obligations OUVERTES : responsible_contact_id + satisfied_at null', () => {
    expect(src).toMatch(/from\('site_obligation'\)[\s\S]*?in\('responsible_contact_id', activeContactIds\)/)
    expect(src).toMatch(/!o\.satisfied_at/)
    expect(src).toContain('openObligationsCount')
  })

  it('les réserves ne comptent PAS pour une personne (pas de FK — issued_by texte libre)', () => {
    expect(src).not.toContain('site_reserve')
  })

  it('la « dernière activité » vient de traces STRUCTURÉES, jamais d’une présence supposée', () => {
    expect(src).toContain('lastStructuredByContact')
    // aucune agrégation depuis participants (JSONB texte libre)
    expect(src).not.toMatch(/participants[\s\S]{0,80}contact/i)
  })
})
