import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── P0-1 — Vérité temporelle dans le graphe Explorer ─────────────────────────
//
// Avant ce correctif, les nœuds action/échéance de site-graph.ts utilisaient
// `created_at` comme date d'apparition dans le replay — un PV historique importé
// le 03/09 faisait apparaître toutes ses actions le 03/09 plutôt qu'à leur date
// métier réelle (22/07, 19/02, etc.).
//
// Doctrine produit (GO Vincent 2026-09-03) :
//   - objet rattaché à un report → tOf(report_id) = date métier du PV source
//   - objet natif sans report_id → fallback created_at (création directe = légitime)
//   - created_at ne doit jamais être présenté comme date de PV/visite
//
// Ces tests vérifient les invariants que le typecheck ne peut pas protéger.

const SRC = 'lib/knowledge/site-graph.ts'
const src = readFileSync(join(process.cwd(), SRC), 'utf8')

describe('site-graph — vérité temporelle P0-1', () => {
  it('les nœuds action utilisent tOf(report_id) et non created_at brut', () => {
    // t: a.created_at était le pattern interdit avant le correctif
    expect(src).not.toMatch(/t:\s*a\.created_at(?!\s*\?\?)/)
    expect(src).toMatch(/t:\s*tOf\(a\.report_id\)\s*\?\?\s*a\.created_at/)
  })

  it('les nœuds échéance utilisent tOf(report_id) et non created_at brut', () => {
    expect(src).not.toMatch(/t:\s*d\.created_at(?!\s*\?\?)/)
    expect(src).toMatch(/t:\s*tOf\(d\.report_id\)\s*\?\?\s*d\.created_at/)
  })

  it('le tooltip acteur→action utilise tOf(report_id) comme date', () => {
    // fr(a.created_at) dans une arête était le pattern interdit
    expect(src).not.toMatch(/date:\s*fr\(a\.created_at\)/)
    expect(src).toMatch(/date:\s*fr\(tOf\(a\.report_id\)\s*\?\?\s*a\.created_at\)/)
  })

  it('le fallback created_at est conservé pour les objets natifs sans report_id', () => {
    // Les trois occurrences de ?? a.created_at / ?? d.created_at doivent exister
    // pour que les objets MemorIA natifs (report_id null) restent dans le replay.
    const actionFallback = src.match(/tOf\(a\.report_id\)\s*\?\?\s*a\.created_at/g)
    const deadlineFallback = src.match(/tOf\(d\.report_id\)\s*\?\?\s*d\.created_at/g)
    expect(actionFallback?.length).toBeGreaterThanOrEqual(2)  // nœud + tooltip
    expect(deadlineFallback?.length).toBeGreaterThanOrEqual(1)
  })
})
