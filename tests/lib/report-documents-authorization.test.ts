import { describe, it, expect, vi, beforeEach } from 'vitest'

// KOUTIO B1.5 POST-INJECTION CHECKPOINT — PROVENANCE != AUTORISATION.
// `created_by` est une métadonnée d'attribution ; l'autorisation passe TOUJOURS
// par `requireOrganizationMembership`, soit via les cookies de la requête (web,
// défaut), soit via `actorUserId` explicite (scripts internes uniquement).
// `created_by` ne doit JAMAIS, à lui seul, influencer le résultat de l'autorisation.

const membershipCalls: Array<{ organizationId: string; currentUser: unknown }> = []
let membershipResult: { ok: true; context: unknown } | { ok: false; error: string } = {
  ok: true,
  context: { userId: 'member-1', organizationId: 'org-1', role: 'manager' },
}

vi.mock('@/lib/auth/memberships', () => ({
  requireOrganizationMembership: vi.fn(async (organizationId: string, currentUser: unknown) => {
    membershipCalls.push({ organizationId, currentUser })
    return membershipResult
  }),
}))

const insertedRows: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'site_reports') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { organization_id: 'org-1' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'report_documents') {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                insertedRows.push(row)
                return { data: { id: 'doc-1' }, error: null }
              },
            }),
          }),
        }
      }
      throw new Error(`Table non mockée : ${table}`)
    },
  }),
}))

import { createReportDocument } from '@/lib/db/report-documents'

const baseInput = {
  report_id: 'report-1',
  site_id: 'site-1',
  template_key: 'cr_visite.v1',
  sections: [],
  provider: null,
  model: null,
  prompt_version: null,
}

beforeEach(() => {
  membershipCalls.length = 0
  insertedRows.length = 0
  membershipResult = { ok: true, context: { userId: 'member-1', organizationId: 'org-1', role: 'manager' } }
})

describe('createReportDocument — PROVENANCE != AUTORISATION', () => {
  it('appel web/session (actorUserId omis) : la vérification retombe sur les cookies (currentUser=undefined)', async () => {
    await createReportDocument({ ...baseInput, created_by: 'user-session-1' })
    expect(membershipCalls).toEqual([{ organizationId: 'org-1', currentUser: undefined }])
  })

  it('created_by seul ne peut jamais accorder ou refuser l’accès : la vérification ignore created_by', async () => {
    membershipResult = { ok: false, error: 'Accès refusé' }
    await expect(
      createReportDocument({ ...baseInput, created_by: 'nimporte-qui-membre-reel' }),
    ).rejects.toThrow('Accès refusé')
    // Même currentUser=undefined qu'un created_by absent : created_by n'a jamais été lu pour l'autorisation.
    expect(membershipCalls).toEqual([{ organizationId: 'org-1', currentUser: undefined }])
  })

  it('chemin interne explicite (actorUserId) : un membre réel de l’org autorise l’écriture', async () => {
    const id = await createReportDocument({ ...baseInput, created_by: 'david-demo', actorUserId: 'david-demo' })
    expect(id).toBe('doc-1')
    expect(membershipCalls).toEqual([{ organizationId: 'org-1', currentUser: { id: 'david-demo' } }])
  })

  it('chemin interne explicite avec un acteur hors organisation : refusé (fail-closed)', async () => {
    membershipResult = { ok: false, error: 'Accès refusé' }
    await expect(
      createReportDocument({ ...baseInput, created_by: 'david-demo', actorUserId: 'intrus-autre-org' }),
    ).rejects.toThrow('Accès refusé')
    expect(membershipCalls).toEqual([{ organizationId: 'org-1', currentUser: { id: 'intrus-autre-org' } }])
    expect(insertedRows).toHaveLength(0)
  })
})
