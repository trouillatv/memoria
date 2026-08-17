// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { normalizeActorLabel, actorTokenContainment, resolveActorTarget } from '@/lib/db/actor-alias-resolve'

// PETRO (données réelles) n'a qu'un seul contact et 6 sociétés sans collision
// de nom — aucune ambiguïté naturelle disponible pour le harnais de recette
// live (cf. scripts/recette-actor-alias-run.ts). Le chemin `ambiguous` est
// donc prouvé ici par un mock Supabase déterministe plutôt qu'en créant des
// fixtures dans une organisation réelle (hors périmètre de P4-B.2).
type Row = Record<string, unknown>
function mockSupabase(companies: Row[], contacts: Row[]) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          is: async () => ({ data: table === 'companies' ? companies : contacts }),
        }),
      }),
    }),
  }
}

let currentMock: ReturnType<typeof mockSupabase> = mockSupabase([], [])
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => currentMock,
}))

describe('normalizeActorLabel', () => {
  it('minuscules et sans accents', () => {
    expect(normalizeActorLabel('Jérôme MARTIN')).toBe('jerome martin')
  })
  it('supprime la ponctuation', () => {
    expect(normalizeActorLabel('Clim-Expair (Nouméa)')).toBe('clim expair noumea')
  })
})

describe('actorTokenContainment — base du resolver P4-B.2', () => {
  it('"Jérôme" ⊆ "Jérôme Martin" → true', () => {
    expect(actorTokenContainment('Jérôme', 'Jérôme Martin')).toBe(true)
  })
  it('"Jérôme" ⊆ "Jérôme Dupont" → true (même prénom, cible différente)', () => {
    expect(actorTokenContainment('Jérôme', 'Jérôme Dupont')).toBe(true)
  })
  it('"Martin Dupont" ⊄ "Jérôme Martin" → false (tokens incomplets)', () => {
    expect(actorTokenContainment('Martin Dupont', 'Jérôme Martin')).toBe(false)
  })
  it('"Clim Expair" ⊆ "Clim Expair" → true (identique)', () => {
    expect(actorTokenContainment('Clim Expair', 'Clim Expair')).toBe(true)
  })
  it('mention vide → false', () => {
    expect(actorTokenContainment('', 'Jérôme Martin')).toBe(false)
  })
})

describe('resolveActorTarget — ambiguïté, not_found, désambiguïsation par targetOrg', () => {
  it('deux sociétés homonymes "Acme" → ambiguous avec les 2 candidats', async () => {
    currentMock = mockSupabase(
      [
        { id: 'c1', name: 'Acme', short_name: null },
        { id: 'c2', name: 'Acme', short_name: null },
      ],
      [],
    )
    const result = await resolveActorTarget('org-1', 'Acme')
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2)
      expect(result.candidates.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    }
  })

  it('aucune correspondance (ni exacte ni containment) → not_found', async () => {
    currentMock = mockSupabase([{ id: 'c1', name: 'Acme', short_name: null }], [])
    const result = await resolveActorTarget('org-1', 'Société Inexistante')
    expect(result).toEqual({ kind: 'not_found' })
  })

  it('base vide (aucune société ni contact) → not_found', async () => {
    currentMock = mockSupabase([], [])
    const result = await resolveActorTarget('org-1', 'Peu importe')
    expect(result).toEqual({ kind: 'not_found' })
  })

  it('deux contacts "Jérôme Martin" dans deux entreprises différentes + targetOrg → resolved (narrowing à 1)', async () => {
    currentMock = mockSupabase(
      [
        { id: 'c1', name: 'BECIB', short_name: null },
        { id: 'c2', name: 'AGP', short_name: null },
      ],
      [
        { id: 'p1', full_name: 'Jérôme Martin', company_id: 'c1' },
        { id: 'p2', full_name: 'Jérôme Martin', company_id: 'c2' },
      ],
    )
    const result = await resolveActorTarget('org-1', 'Jérôme Martin', 'BECIB')
    expect(result).toEqual({
      kind: 'resolved',
      candidate: { kind: 'contact', id: 'p1', label: 'Jérôme Martin', companyId: 'c1' },
    })
  })

  it('targetOrg qui ne correspond à aucun candidat → fallback sur l\'ensemble ambigu complet (jamais de perte d\'info)', async () => {
    currentMock = mockSupabase(
      [
        { id: 'c1', name: 'BECIB', short_name: null },
        { id: 'c2', name: 'AGP', short_name: null },
      ],
      [
        { id: 'p1', full_name: 'Jérôme Martin', company_id: 'c1' },
        { id: 'p2', full_name: 'Jérôme Martin', company_id: 'c2' },
      ],
    )
    const result = await resolveActorTarget('org-1', 'Jérôme Martin', 'Société Absente')
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(2)
    }
  })
})
