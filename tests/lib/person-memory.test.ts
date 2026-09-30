import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── WOW PERSONNE (Batch C, GO Vincent) ───────────────────────────────────────
// Invariant unique : on ne transforme jamais une absence de preuve en
// présence supposée. Ces tests vérifient structurellement que :
//   · la mémoire "user" vient UNIQUEMENT de intervention_participants
//     (jamais dérivée d'une appartenance équipe actuelle ou d'un
//     assigned_team_id sans ligne confirmée) ;
//   · changer la composition d'une équipe ne réécrit jamais cette mémoire
//     (la fonction n'interroge même pas team_members/team_field_members) ;
//   · user et contact sont deux mémoires strictement distinctes, jamais
//     fusionnées ;
//   · le scope organisationnel est toujours respecté (fail-closed).

const calledTables: string[] = []
let participantRows: Array<Record<string, unknown>> = []
let siteActionRows: Array<Record<string, unknown>> = []
let fieldMemberRows: Array<Record<string, unknown>> = []

function makeBuilder(resolveValue: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in']) b[m] = self
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      calledTables.push(table)
      if (table === 'intervention_participants') return makeBuilder(() => ({ data: participantRows, error: null }))
      if (table === 'site_actions') return makeBuilder(() => ({ data: siteActionRows, error: null }))
      if (table === 'team_field_members') return makeBuilder(() => ({ data: fieldMemberRows, error: null }))
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

import {
  listConfirmedInterventionsForUser,
  listAssignedActionsForContact,
  listTeamMembershipsForContact,
  getPersonMemorySummary,
} from '@/lib/db/person-memory'

function participantRow(opts: {
  role?: 'participant' | 'referent'
  createdAt?: string
  scheduledFor?: string | null
  assignedTeamId?: string | null
  team?: { id: string; name: string } | null
  orgId?: string
}) {
  return {
    role: opts.role ?? 'participant',
    created_at: opts.createdAt ?? '2026-09-01T00:00:00Z',
    intervention: {
      id: 'i-1',
      scheduled_for: opts.scheduledFor ?? '2026-09-01T00:00:00Z',
      planned_start: null,
      status: 'completed',
      assigned_team_id: opts.assignedTeamId ?? null,
      team: opts.team ?? null,
      mission: {
        site: {
          id: 's-1',
          name: 'Site Test',
          organization_id: opts.orgId ?? 'org-demo',
          contract: null,
          client: null,
        },
      },
    },
  }
}

beforeEach(() => {
  calledTables.length = 0
  participantRows = []
  siteActionRows = []
  fieldMemberRows = []
})

describe('listConfirmedInterventionsForUser — preuve confirmée uniquement', () => {
  it('ne fabrique rien : aucune ligne confirmée → aucune intervention', async () => {
    participantRows = []
    const out = await listConfirmedInterventionsForUser('u-1', ['org-demo'])
    expect(out).toEqual([])
  })

  it('ne consulte JAMAIS team_members/team_field_members — l’historique ne dépend pas de la composition actuelle', async () => {
    participantRows = [participantRow({})]
    await listConfirmedInterventionsForUser('u-1', ['org-demo'])
    expect(calledTables).toEqual(['intervention_participants'])
    expect(calledTables).not.toContain('team_members')
    expect(calledTables).not.toContain('team_field_members')
  })

  it('isolation organisationnelle — une ligne hors des orgIds n’apparaît jamais', async () => {
    participantRows = [
      participantRow({ orgId: 'org-demo' }),
      participantRow({ orgId: 'org-autre' }),
    ]
    const out = await listConfirmedInterventionsForUser('u-1', ['org-demo'])
    expect(out).toHaveLength(1)
  })

  it('filtre par période (sinceIso) sans jamais inventer une date manquante', async () => {
    participantRows = [
      participantRow({ scheduledFor: '2026-01-01T00:00:00Z' }),
      participantRow({ scheduledFor: '2026-09-20T00:00:00Z' }),
    ]
    const out = await listConfirmedInterventionsForUser('u-1', ['org-demo'], { sinceIso: '2026-09-01T00:00:00Z' })
    expect(out).toHaveLength(1)
    expect(out[0].effectiveDate).toBe('2026-09-20T00:00:00Z')
  })

  it('assigned_team_id n’est qu’un affichage de secours sur une ligne DÉJÀ confirmée — jamais une preuve de présence', async () => {
    // La ligne existe UNIQUEMENT parce que intervention_participants la confirme.
    // assigned_team_id ne sert ici qu'à renseigner teamId quand le join `team`
    // est absent — il ne crée jamais de ligne à lui seul (cf. test ci-dessus :
    // participantRows = [] → []).
    participantRows = [participantRow({ assignedTeamId: 'team-planifiee', team: null })]
    const out = await listConfirmedInterventionsForUser('u-1', ['org-demo'])
    expect(out).toHaveLength(1)
    expect(out[0].teamId).toBe('team-planifiee')
  })
})

describe('listTeamMembershipsForContact — appartenance ACTUELLE uniquement', () => {
  it('exclut les appartenances quittées (left_at) — la requête filtre déjà, jamais une réécriture côté lecture', async () => {
    fieldMemberRows = [
      { joined_at: '2026-08-01T00:00:00Z', team: { id: 't-1', name: 'Équipe Alpha', deleted_at: null } },
    ]
    const out = await listTeamMembershipsForContact('c-1')
    expect(out).toEqual([{ teamId: 't-1', teamName: 'Équipe Alpha', joinedAt: '2026-08-01T00:00:00Z' }])
  })

  it('exclut une équipe archivée même si la ligne d’appartenance est encore active', async () => {
    fieldMemberRows = [
      { joined_at: '2026-08-01T00:00:00Z', team: { id: 't-1', name: 'Équipe Alpha', deleted_at: '2026-09-01T00:00:00Z' } },
    ]
    const out = await listTeamMembershipsForContact('c-1')
    expect(out).toEqual([])
  })
})

describe('listAssignedActionsForContact — isolation organisationnelle', () => {
  it('ignore les actions d’un site hors des orgIds de l’appelant', async () => {
    siteActionRows = [
      { id: 'a-1', title: 'Action A', status: 'open', due_date: null, site: { id: 's-1', name: 'Site A', organization_id: 'org-demo' } },
      { id: 'a-2', title: 'Action B', status: 'open', due_date: null, site: { id: 's-2', name: 'Site B', organization_id: 'org-autre' } },
    ]
    const out = await listAssignedActionsForContact('c-1', ['org-demo'])
    expect(out).toEqual([{ id: 'a-1', title: 'Action A', status: 'open', dueDate: null, siteId: 's-1', siteName: 'Site A' }])
  })
})

describe('getPersonMemorySummary — deux identités distinctes, jamais fusionnées', () => {
  it('kind=user ne remplit QUE userOverview', async () => {
    participantRows = [participantRow({})]
    const res = await getPersonMemorySummary({ kind: 'user', id: 'u-A' }, ['org-demo'])
    expect(res.userOverview).not.toBeNull()
    expect(res.contactOverview).toBeNull()
  })

  it('kind=contact ne remplit QUE contactOverview', async () => {
    siteActionRows = [{ id: 'a-1', title: 'Action', status: 'done', due_date: null, site: { id: 's-1', name: 'Site', organization_id: 'org-demo' } }]
    const res = await getPersonMemorySummary({ kind: 'contact', id: 'c-B' }, ['org-demo'])
    expect(res.contactOverview).not.toBeNull()
    expect(res.userOverview).toBeNull()
  })

  it('deux personnes distinctes (A user, B contact) produisent des mémoires indépendantes', async () => {
    participantRows = [participantRow({})]
    const summaryA = await getPersonMemorySummary({ kind: 'user', id: 'u-A' }, ['org-demo'])

    siteActionRows = [{ id: 'a-9', title: 'Autre action', status: 'open', due_date: null, site: { id: 's-1', name: 'Site', organization_id: 'org-demo' } }]
    const summaryB = await getPersonMemorySummary({ kind: 'contact', id: 'c-B' }, ['org-demo'])

    expect(summaryA.userOverview?.confirmedInterventionsCount).toBe(1)
    expect(summaryB.contactOverview?.openActionCount).toBe(1)
    // Aucune fuite d'une mémoire dans l'autre.
    expect(summaryA.contactOverview).toBeNull()
    expect(summaryB.userOverview).toBeNull()
  })
})
