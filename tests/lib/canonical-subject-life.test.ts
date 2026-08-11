import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

const SRC = 'lib/db/canonical-subject-life.ts'

// ── Lot 4 : résolution d'entités dans le read-model ──────────────────────────

describe('canonical-subject-life — Lot 4 : entity resolution', () => {
  it('resolvedLabel est déclaré dans SubjectOccurrenceMerged', () => {
    expect(codeOf(SRC)).toContain('resolvedLabel: string | null')
  })

  it('entity_ids est inclus dans les trois selects CSO', () => {
    const src = codeOf(SRC)
    const selects = [...src.matchAll(/\.select\(['"]([\s\S]*?)['"]\)/g)].map((m) => m[1])
    const csoSelects = selects.filter((s) => s.includes('source_ref_id'))
    expect(csoSelects.length, 'attendu 3 selects CSO (native, fallback, main)').toBeGreaterThanOrEqual(3)
    for (const s of csoSelects) {
      expect(s, `select sans entity_ids : "${s.slice(0, 60)}..."`).toContain('entity_ids')
    }
  })

  it('applyEntitySubstitution retourne null si entity_ids est vide', () => {
    // Vérifie la règle : pas de résolution heuristique si entity_ids est absent
    const src = codeOf(SRC)
    expect(src).toContain('if (!label || !entityIds?.length) return null')
  })

  it('buildNativeEvolutionData ne lit pas entity_ids (labels hors résolution)', () => {
    const src = codeOf(SRC)
    // buildNativeEvolutionData doit utiliser le label brut sans entity_ids
    const fnStart = src.indexOf('export async function buildNativeEvolutionData')
    expect(fnStart, 'buildNativeEvolutionData introuvable').toBeGreaterThanOrEqual(0)
    const fnBody = src.slice(fnStart, fnStart + 800)
    expect(fnBody).not.toContain('entity_ids')
    expect(fnBody).not.toContain('applyEntitySubstitution')
  })

  it('les occurrences historical_pdf ont resolvedLabel: null (preuve historique figée)', () => {
    const src = codeOf(SRC)
    // Vérifie que les deux chemins PDF ne tentent pas de résoudre les entités
    const gaps = src.match(/isGap: true[\s\S]{0,200}resolvedLabel: null/g) ?? []
    expect(gaps.length, 'occurrences gap sans resolvedLabel null').toBeGreaterThanOrEqual(1)
  })
})
