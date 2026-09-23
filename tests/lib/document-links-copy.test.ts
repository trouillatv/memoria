import { beforeEach, describe, expect, it, vi } from 'vitest'

// P0-1B2 correction invariant C (Vincent 2026-09-24) : un document peut être
// rattaché à plusieurs cibles (site, contrat, AO, client, obligation…) via
// document_links. Quand une version est remplacée, l'ancienne version
// disparaît des listes (`superseded` filtré) — copyDocumentLinks doit donc
// reporter TOUS ses rattachements vers la nouvelle version, pas seulement
// celui de la page depuis laquelle l'upload a été fait. Sinon la nouvelle
// version devient invisible pour les AUTRES consommateurs de l'ancienne
// (ex. mise à jour depuis un chantier -> disparition sur un contrat lié).

const FROM_ID = 'old-doc-1'
const TO_ID = 'new-doc-1'

let existingLinks: Array<{ target_type: string; target_id: string; reference_label: string | null }> = []
const upsertCalls: Array<{ rows: unknown; opts: unknown }> = []
const selectEq = vi.fn(async (_column: string, _value: string) => ({ data: existingLinks, error: null }))
const upsert = vi.fn(async (rows: unknown, opts: unknown) => {
  upsertCalls.push({ rows, opts })
  return { error: null }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'document_links') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({ eq: (column: string, value: string) => selectEq(column, value) }),
        upsert: (rows: unknown, opts: unknown) => upsert(rows, opts),
      }
    },
  }),
}))

const { copyDocumentLinks } = await import('@/lib/db/documents')

beforeEach(() => {
  vi.clearAllMocks()
  upsertCalls.length = 0
  existingLinks = []
})

describe('copyDocumentLinks', () => {
  it('reporte TOUS les rattachements (site + contrat) de l’ancienne version vers la nouvelle', async () => {
    existingLinks = [
      { target_type: 'site', target_id: 'site-ocef', reference_label: null },
      { target_type: 'contract', target_id: 'contract-x', reference_label: 'Article 4' },
    ]

    await copyDocumentLinks(FROM_ID, TO_ID)

    expect(selectEq).toHaveBeenCalledWith('document_id', FROM_ID)
    expect(upsertCalls).toHaveLength(1)
    const [{ rows, opts }] = upsertCalls
    expect(rows).toEqual([
      { document_id: TO_ID, target_type: 'site', target_id: 'site-ocef', reference_label: null },
      { document_id: TO_ID, target_type: 'contract', target_id: 'contract-x', reference_label: 'Article 4' },
    ])
    expect(opts).toEqual({ onConflict: 'document_id,target_type,target_id' })
  })

  it('ne fait rien si l’ancienne version n’a aucun lien', async () => {
    existingLinks = []
    await copyDocumentLinks(FROM_ID, TO_ID)
    expect(upsert).not.toHaveBeenCalled()
  })
})
