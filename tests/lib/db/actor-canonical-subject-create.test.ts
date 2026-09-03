// Correctif get-or-reuse (audit actor_cs_create_failed, 14/14 = Classe A, GO Vincent 2026-09-03).
//
// Avant ce correctif, une violation de canonical_subject_active_normalized_label_uniq
// (mig 323) faisait perdre silencieusement le rattachement du thread orphelin (continue).
// Ces cas couvrent la liste obligatoire avant tout commit :
//   1. création normale
//   2. collision même acteur (même label normalisé, même site) → réutilisation
//   3. autre erreur SQL → reste une erreur (jamais de fallback générique)
//   4. collision mais aucun actif correspondant retrouvé → reste une erreur (garde-fou)
//   5. code 23505 mais SUR UNE AUTRE CONTRAINTE (ex. uq_canonical_subject_active_contact)
//      → reste une erreur (préflight Vincent 2026-09-03 : PostgrestError n'a pas de champ
//      `constraint`, donc le nom de contrainte doit être vérifié dans le message)

import { describe, it, expect } from 'vitest'
import { createOrReuseActorCanonicalSubject } from '@/lib/db/actor-canonical-subject-create'

type Row = Record<string, unknown>

// Faux client Supabase minimal : insert(...).select().single() + select().eq().eq().
function makeFakeSupabase(
  activeSubjects: Row[],
  opts: { insertShouldConflict: boolean; insertErrorCode?: string; insertErrorMessage?: string },
) {
  return {
    from: (table: string) => {
      if (table !== 'canonical_subject') throw new Error(`unexpected table ${table}`)
      let insertPayload: Row = {}
      const filters: Array<(r: Row) => boolean> = []
      const api = {
        insert: (p: Row) => ((insertPayload = p), api),
        select: () => api,
        eq: (f: string, v: unknown) => (filters.push((r) => r[f] === v), api),
        single: async () => {
          if (opts.insertShouldConflict) {
            return {
              data: null,
              error: {
                code: opts.insertErrorCode ?? '23505',
                message:
                  opts.insertErrorMessage ??
                  'duplicate key value violates unique constraint "canonical_subject_active_normalized_label_uniq"',
              },
            }
          }
          return { data: { id: 'new-cs-id', ...insertPayload }, error: null }
        },
        then: (resolve: (x: { data: Row[] | null; error: null }) => void) => {
          const rows = activeSubjects.filter((r) => filters.every((f) => f(r)))
          return resolve({ data: rows, error: null })
        },
      }
      return api
    },
  }
}

describe('createOrReuseActorCanonicalSubject', () => {
  it('création normale : aucune collision → nouveau canonical_subject', async () => {
    const supabase = makeFakeSupabase([], { insertShouldConflict: false })
    const result = await createOrReuseActorCanonicalSubject(supabase, 'site-1', 'David BOUVIER')
    expect(result).toEqual({ outcome: 'created', id: 'new-cs-id' })
  })

  it('collision même acteur (même label normalisé) → réutilise le canonical_subject actif existant', async () => {
    const supabase = makeFakeSupabase(
      [{ id: 'existing-cs-id', site_id: 'site-1', status: 'active', label: 'David BOUVIER' }],
      { insertShouldConflict: true },
    )
    const result = await createOrReuseActorCanonicalSubject(supabase, 'site-1', 'David BOUVIER')
    expect(result).toEqual({ outcome: 'reused', id: 'existing-cs-id' })
  })

  it('collision avec variation de casse/accents → toujours reconnu comme le même acteur (normalisation)', async () => {
    const supabase = makeFakeSupabase(
      [{ id: 'existing-cs-id', site_id: 'site-1', status: 'active', label: 'SACD (GBH)' }],
      { insertShouldConflict: true },
    )
    const result = await createOrReuseActorCanonicalSubject(supabase, 'site-1', 'sacd (gbh)')
    expect(result).toEqual({ outcome: 'reused', id: 'existing-cs-id' })
  })

  it('autre erreur SQL (pas 23505) → reste une erreur, aucun fallback', async () => {
    const supabase = makeFakeSupabase([], { insertShouldConflict: true, insertErrorCode: '42501' })
    const result = await createOrReuseActorCanonicalSubject(supabase, 'site-1', 'David BOUVIER')
    expect(result.outcome).toBe('error')
  })

  it('collision signalée mais aucun actif correspondant retrouvé → reste une erreur (garde-fou, pas de fusion aveugle)', async () => {
    const supabase = makeFakeSupabase([], { insertShouldConflict: true })
    const result = await createOrReuseActorCanonicalSubject(supabase, 'site-1', 'David BOUVIER')
    expect(result.outcome).toBe('error')
  })

  it('code 23505 mais sur une autre contrainte (ex. uq_canonical_subject_active_contact) → reste une erreur, aucun fallback', async () => {
    const supabase = makeFakeSupabase(
      [{ id: 'existing-cs-id', site_id: 'site-1', status: 'active', label: 'David BOUVIER' }],
      {
        insertShouldConflict: true,
        insertErrorMessage: 'duplicate key value violates unique constraint "uq_canonical_subject_active_contact"',
      },
    )
    const result = await createOrReuseActorCanonicalSubject(supabase, 'site-1', 'David BOUVIER')
    expect(result.outcome).toBe('error')
  })
})
