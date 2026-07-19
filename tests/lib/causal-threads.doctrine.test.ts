import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Mémoire causale — read model serveur : liens RÉELS uniquement ────────────
const src = readFileSync(join(process.cwd(), 'lib/knowledge/causal-threads.ts'), 'utf8')

describe('getSiteCausalThreads — suit les liens du chantier, jamais une inférence', () => {
  it('fail-closed org + scope chantier', () => {
    expect(src).toContain('getOrgId')
    expect(src).toContain('organization_id')
    expect(src).toMatch(/from\('site_actions'\)[\s\S]*?eq\('site_id', siteId\)/)
  })

  it('la décision d’une action vient du reverse-lookup site_decisions.action_id (lien réel)', () => {
    expect(src).toMatch(/from\('site_decisions'\)[\s\S]*?in\('action_id', actionIds\)/)
  })

  it('la réserve est passée comme « reserve » (lien —), jamais comme origine/cause de l’action', () => {
    // Elle alimente la part `reserve` (assembleThread la relie en 'lie'), pas `origin`.
    expect(src).toMatch(/const reserve = hasReserve/)
    expect(src).toContain("from('site_reserve')")
  })

  it('la composition (et donc la doctrine des relations) passe par le module PUR', () => {
    expect(src).toContain('assembleThread(')
    expect(src).not.toMatch(/relationFromPrev/) // aucune relation typée à la main ici
  })

  it('une action sans histoire causale (ni décision, ni réserve, ni réunion) n’invente pas de fil', () => {
    expect(src).toMatch(/if \(!dec && !hasReserve && !hasOrigin\) continue/)
  })

  it('aucun tri temporel utilisé comme causalité (les liens sont des FK, pas des dates)', () => {
    // Le seul order() est celui de lecture (created_at asc) — pas une déduction de cause.
    expect(src).not.toMatch(/sort\([\s\S]*?date/i)
  })
})
