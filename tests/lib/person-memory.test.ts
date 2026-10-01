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
let photoRows: Array<Record<string, unknown>> = []

function makeBuilder(resolveValue: () => { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in']) b[m] = self
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveValue()).then(resolve, reject)
  return b
}

function makePhotoBuilder() {
  const b: Record<string, unknown> = {}
  const self = () => b
  let takenByFilter: string | undefined
  for (const m of ['select', 'order', 'limit', 'is', 'in']) b[m] = self
  // `.eq('taken_by', userId)` filtre réellement — seul moyen de prouver
  // via un mock qu'une photo d'un AUTRE user n'est jamais retournée.
  b.eq = (col: string, val: unknown) => {
    if (col === 'taken_by') takenByFilter = val as string
    return self()
  }
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const filtered = takenByFilter ? photoRows.filter((r) => r.taken_by === takenByFilter) : photoRows
    return Promise.resolve({ data: filtered, error: null }).then(resolve, reject)
  }
  return b
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      calledTables.push(table)
      if (table === 'intervention_participants') return makeBuilder(() => ({ data: participantRows, error: null }))
      if (table === 'site_actions') return makeBuilder(() => ({ data: siteActionRows, error: null }))
      if (table === 'team_field_members') return makeBuilder(() => ({ data: fieldMemberRows, error: null }))
      if (table === 'intervention_photos') return makePhotoBuilder()
      return makeBuilder(() => ({ data: [], error: null }))
    },
  }),
}))

vi.mock('@/lib/storage/intervention-photos', () => ({
  getSignedPhotoUrlsThumb: async (paths: string[]) => new Map(paths.map((p) => [p, `signed://${p}`])),
}))

import {
  listConfirmedInterventionsForUser,
  listAssignedActionsForContact,
  listTeamMembershipsForContact,
  listTeamMembershipHistoryForContact,
  getPersonMemorySummary,
  getUserMemoryOverview,
  listPhotosForUser,
} from '@/lib/db/person-memory'

function participantRow(opts: {
  role?: 'participant' | 'referent'
  createdAt?: string
  scheduledFor?: string | null
  assignedTeamId?: string | null
  team?: { id: string; name: string } | null
  orgId?: string
  status?: string
}) {
  return {
    role: opts.role ?? 'participant',
    created_at: opts.createdAt ?? '2026-09-01T00:00:00Z',
    intervention: {
      id: 'i-1',
      scheduled_for: opts.scheduledFor ?? '2026-09-01T00:00:00Z',
      planned_start: null,
      status: opts.status ?? 'completed',
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

function photoRow(opts: { takenBy?: string | null; orgId?: string; takenAt?: string }) {
  return {
    id: 'p-1',
    caption: 'Avant/après',
    taken_at: opts.takenAt ?? '2026-09-10T00:00:00Z',
    intervention_id: 'i-1',
    storage_path: 'a.jpg',
    taken_by: opts.takenBy ?? null,
    intervention: {
      id: 'i-1',
      mission: {
        site: { id: 's-1', name: 'Site Test', organization_id: opts.orgId ?? 'org-demo' },
      },
    },
  }
}

beforeEach(() => {
  calledTables.length = 0
  participantRows = []
  siteActionRows = []
  fieldMemberRows = []
  photoRows = []
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

describe('FIX 2 (revue ChatGPT/Vincent) — statut réel requis, jamais `planned`', () => {
  it('une ligne intervention_participants sur une intervention `planned` n’est JAMAIS une participation confirmée', async () => {
    // migration 024 (RLS ip_insert) permet d'écrire dès `planned`/`in_progress` :
    // la présence de la ligne seule ne prouve rien tant que le statut ne l'atteste pas.
    participantRows = [participantRow({ status: 'planned' })]
    const out = await listConfirmedInterventionsForUser('u-1', ['org-demo'])
    expect(out).toEqual([])
  })

  it('un statut `skipped` n’est jamais une participation réalisée', async () => {
    participantRows = [participantRow({ status: 'skipped' })]
    const out = await listConfirmedInterventionsForUser('u-1', ['org-demo'])
    expect(out).toEqual([])
  })

  it('`completed` et `validated` sont attestés (confirmationBasis=attested)', async () => {
    participantRows = [
      participantRow({ status: 'completed' }),
      participantRow({ status: 'validated' }),
    ]
    const out = await listConfirmedInterventionsForUser('u-1', ['org-demo'])
    expect(out).toHaveLength(2)
    expect(out.every((i) => i.confirmationBasis === 'attested')).toBe(true)
  })

  it('`in_progress` apparaît séparément, jamais comme attesté', async () => {
    participantRows = [participantRow({ status: 'in_progress' })]
    const out = await listConfirmedInterventionsForUser('u-1', ['org-demo'])
    expect(out).toHaveLength(1)
    expect(out[0].confirmationBasis).toBe('in_progress')
  })
})

describe('FIX 2 — getUserMemoryOverview compte séparément attesté / en cours', () => {
  it('compteurs et lastConfirmedAt ignorent `planned`, distinguent `in_progress` de l’attesté', async () => {
    participantRows = [
      participantRow({ status: 'completed', scheduledFor: '2026-09-01T00:00:00Z' }),
      participantRow({ status: 'in_progress', scheduledFor: '2026-09-25T00:00:00Z' }),
      participantRow({ status: 'planned', scheduledFor: '2026-09-30T00:00:00Z' }),
    ]
    const overview = await getUserMemoryOverview('u-1', ['org-demo'])
    expect(overview.attestedInterventionsCount).toBe(1)
    expect(overview.inProgressInterventionsCount).toBe(1)
    // La ligne `in_progress` (25 sept) n'est pas close : lastConfirmedAt reste
    // la dernière date ATTESTÉE (1er sept), jamais une date `planned`/en cours.
    expect(overview.lastConfirmedAt).toBe('2026-09-01T00:00:00Z')
  })
})

describe('FIX 1 (revue ChatGPT/Vincent) — listPhotosForUser, taken_by uniquement', () => {
  it('photo taken_by = userId → apparaît', async () => {
    photoRows = [photoRow({ takenBy: 'u-guillaume' })]
    const out = await listPhotosForUser('u-guillaume', ['org-demo'])
    expect(out).toHaveLength(1)
    expect(out[0].signedUrl).toBe('signed://a.jpg')
  })

  it('photo taken_by = un AUTRE user → absente', async () => {
    photoRows = [photoRow({ takenBy: 'u-autre' })]
    const out = await listPhotosForUser('u-guillaume', ['org-demo'])
    expect(out).toEqual([])
  })

  it('taken_by null → jamais attribuée, absente de la mémoire personne', async () => {
    photoRows = [photoRow({ takenBy: null })]
    const out = await listPhotosForUser('u-guillaume', ['org-demo'])
    expect(out).toEqual([])
  })

  it('autre organisation → absente (isolation org fail-closed)', async () => {
    photoRows = [photoRow({ takenBy: 'u-guillaume', orgId: 'org-autre' })]
    const out = await listPhotosForUser('u-guillaume', ['org-demo'])
    expect(out).toEqual([])
  })
})

describe('listTeamMembershipsForContact — appartenance ACTUELLE uniquement', () => {
  it('exclut les appartenances quittées (left_at) — la requête filtre déjà, jamais une réécriture côté lecture', async () => {
    fieldMemberRows = [
      { joined_at: '2026-08-01T00:00:00Z', team: { id: 't-1', name: 'Équipe Alpha', deleted_at: null, organization_id: 'org-demo' } },
    ]
    const out = await listTeamMembershipsForContact('c-1', ['org-demo'])
    expect(out).toEqual([{ teamId: 't-1', teamName: 'Équipe Alpha', joinedAt: '2026-08-01T00:00:00Z' }])
  })

  it('exclut une équipe archivée même si la ligne d’appartenance est encore active', async () => {
    fieldMemberRows = [
      { joined_at: '2026-08-01T00:00:00Z', team: { id: 't-1', name: 'Équipe Alpha', deleted_at: '2026-09-01T00:00:00Z', organization_id: 'org-demo' } },
    ]
    const out = await listTeamMembershipsForContact('c-1', ['org-demo'])
    expect(out).toEqual([])
  })

  it('FIX A (revue ChatGPT/Vincent, 08e355e2) — exclut une équipe hors des organisations accessibles', async () => {
    fieldMemberRows = [
      { joined_at: '2026-08-01T00:00:00Z', team: { id: 't-1', name: 'Équipe Autre Org', deleted_at: null, organization_id: 'org-autre' } },
    ]
    const out = await listTeamMembershipsForContact('c-1', ['org-demo'])
    expect(out).toEqual([])
  })

  it('FIX A — orgIds vide → fail-closed, aucune équipe', async () => {
    fieldMemberRows = [
      { joined_at: '2026-08-01T00:00:00Z', team: { id: 't-1', name: 'Équipe Alpha', deleted_at: null, organization_id: 'org-demo' } },
    ]
    const out = await listTeamMembershipsForContact('c-1', [])
    expect(out).toEqual([])
  })
})

// FIX_REQUIRED (revue ChatGPT/Vincent, 4385708e) — contrairement à
// listTeamMembershipsForContact (actuel uniquement, ci-dessus), l'historique
// COMPLET ne doit jamais éliminer une équipe archivée : elle reste une
// tranche réelle du passé de la personne, simplement marquée teamArchived.
describe('listTeamMembershipHistoryForContact — historique complet, équipe archivée conservée', () => {
  it('membership terminé (left_at renseigné) + équipe archivée → historique conservé avec teamArchived: true', async () => {
    fieldMemberRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: '2025-06-01T00:00:00Z',
        team: { id: 't-1', name: 'Équipe Alpha', deleted_at: '2025-07-01T00:00:00Z', organization_id: 'org-demo' },
      },
    ]
    const out = await listTeamMembershipHistoryForContact('c-1', ['org-demo'])
    expect(out).toEqual([
      {
        teamId: 't-1',
        teamName: 'Équipe Alpha',
        joinedAt: '2025-01-01T00:00:00Z',
        leftAt: '2025-06-01T00:00:00Z',
        teamArchived: true,
      },
    ])
  })

  it('membership left_at=null + équipe archivée → conservé, teamArchived: true (jamais présenté comme actuel)', async () => {
    fieldMemberRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: null,
        team: { id: 't-1', name: 'Équipe Alpha', deleted_at: '2025-07-01T00:00:00Z', organization_id: 'org-demo' },
      },
    ]
    const out = await listTeamMembershipHistoryForContact('c-1', ['org-demo'])
    expect(out).toEqual([
      {
        teamId: 't-1',
        teamName: 'Équipe Alpha',
        joinedAt: '2025-01-01T00:00:00Z',
        leftAt: null,
        teamArchived: true,
      },
    ])
  })

  it('équipe hors des organisations accessibles → toujours invisible, même archivée', async () => {
    fieldMemberRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: null,
        team: { id: 't-1', name: 'Équipe Autre Org', deleted_at: null, organization_id: 'org-autre' },
      },
    ]
    const out = await listTeamMembershipHistoryForContact('c-1', ['org-demo'])
    expect(out).toEqual([])
  })

  it('orgIds vide → fail-closed, aucune équipe', async () => {
    fieldMemberRows = [
      {
        joined_at: '2025-01-01T00:00:00Z',
        left_at: null,
        team: { id: 't-1', name: 'Équipe Alpha', deleted_at: null, organization_id: 'org-demo' },
      },
    ]
    const out = await listTeamMembershipHistoryForContact('c-1', [])
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

    expect(summaryA.userOverview?.attestedInterventionsCount).toBe(1)
    expect(summaryB.contactOverview?.openActionCount).toBe(1)
    // Aucune fuite d'une mémoire dans l'autre.
    expect(summaryA.contactOverview).toBeNull()
    expect(summaryB.userOverview).toBeNull()
  })
})
