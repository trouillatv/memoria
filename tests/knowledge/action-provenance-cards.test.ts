// Résolveur de provenance des cartes (GO Vincent, 2026-09-01). Batch, structurel,
// aucune heuristique. Prouve les 4 témoins de recette au niveau donnée : PV
// importé, vraie visite terrain, réunion, création manuelle — plus l'absence de
// ligne quand l'origine est réellement inconnue.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>> }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (t: string) => ({ select: () => ({ in: async () => ({ data: h.tables[t] ?? [] }) }) }),
  }),
}))

const { resolveActionProvenanceLines } = await import('@/lib/knowledge/action-provenance-cards')

type Row = Parameters<typeof resolveActionProvenanceLines>[0][number]
function row(over: Partial<Row> & { id: string }): Row {
  return {
    site_id: 's1',
    report_id: null, reserve_id: null, source_capture_id: null, subject_id: null, created_from: null,
    ...over,
  }
}

beforeEach(() => { h.tables = {} })

describe('resolveActionProvenanceLines — 4 témoins + inconnu', () => {
  it("PV importé (origin='import') → « Issue du PV du … », sans lien /m", async () => {
    h.tables = { site_reports: [{ id: 'r1', origin: 'import', started_at: '2026-08-25T00:00:00.000Z', created_at: '2026-08-25T00:00:00.000Z' }] }
    const out = await resolveActionProvenanceLines([row({ id: 'a1', report_id: 'r1', created_from: 'report' })])
    expect(out.a1.label).toBe('Issue du PV du 25 août 2026')
    expect(out.a1.href).toBeNull()
  })

  it('vraie visite terrain → « Issue de la visite du … » + lien /m/visite', async () => {
    h.tables = { site_reports: [{ id: 'r2', origin: 'planned', started_at: '2026-08-30T00:00:00.000Z', created_at: '2026-08-30T00:00:00.000Z' }] }
    const out = await resolveActionProvenanceLines([row({ id: 'a2', report_id: 'r2' })])
    expect(out.a2.label).toBe('Issue de la visite du 30 août 2026')
    expect(out.a2.href).toBe('/m/visite/r2/cr')
  })

  it('réunion (origin null) → « Issue du CR de réunion du … » + lien /m/reunion', async () => {
    h.tables = { site_reports: [{ id: 'r3', origin: null, started_at: '2026-08-18T00:00:00.000Z', created_at: '2026-08-18T00:00:00.000Z' }] }
    const out = await resolveActionProvenanceLines([row({ id: 'a3', report_id: 'r3' })])
    expect(out.a3.label).toBe('Issue du CR de réunion du 18 août 2026')
    expect(out.a3.href).toBe('/m/reunion/r3')
  })

  it('création manuelle (aucune FK, created_from renseigné) → « Créée manuellement », sans lien', async () => {
    const out = await resolveActionProvenanceLines([row({ id: 'a4', created_from: 'mobile_site' })])
    expect(out.a4.label).toBe('Créée manuellement')
    expect(out.a4.href).toBeNull()
  })

  it('origine inconnue (aucune FK, created_from null) → ABSENTE du map (pas de ligne)', async () => {
    const out = await resolveActionProvenanceLines([row({ id: 'a5' })])
    expect(out.a5).toBeUndefined()
  })

  it('capture terrain → résout sa visite (lien /m/visite du report de la capture)', async () => {
    h.tables = {
      visit_capture: [{ id: 'c1', report_id: 'r6' }],
      site_reports: [{ id: 'r6', origin: 'gps', started_at: '2026-08-29T00:00:00.000Z', created_at: '2026-08-29T00:00:00.000Z' }],
    }
    const out = await resolveActionProvenanceLines([row({ id: 'a6', source_capture_id: 'c1' })])
    expect(out.a6.label).toBe('Issue de la visite du 29 août 2026')
    expect(out.a6.href).toBe('/m/visite/r6/cr')
  })

  it('source présente mais objet disparu → absente (la fiche dira « indisponible », pas la carte)', async () => {
    h.tables = { site_reports: [] } // r7 introuvable
    const out = await resolveActionProvenanceLines([row({ id: 'a7', report_id: 'r7', created_from: 'report' })])
    expect(out.a7).toBeUndefined()
  })
})
