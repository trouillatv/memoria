// Tests unitaires — projection canonical_business_object (P1-C2A.1)
//
// Cas couverts :
//  1. groupEventsByCbo — regroupe uniquement par cboId, jamais par ressemblance de texte
//  2. groupEventsByCbo — un événement sans CBO reste sa propre entrée
//  3. groupEventsByCbo — ne fusionne jamais deux CBO différents
//  4. projectCanonicalBusinessObjects — sentinelle FT Matériaux : 7 lignes → 1 entrée
//  5. projectCanonicalBusinessObjects — sentinelle Regard R4 : 2 réserves groupées + 1 échéance isolée → 2 entrées
//  6. projectCanonicalBusinessObjects — sentinelle Enrobage : largeur et épaisseurs restent 2 entrées distinctes
//  7. projectCanonicalBusinessObjects — statut uniforme conservé ; statut divergent → statusIsDivergent + status null
//  8. projectCanonicalBusinessObjects — liste vide → aucune requête DB, résultat []
//  9. Les membres physiques (life.materializedEvents) ne sont jamais perdus : présents dans entry.members

import { describe, it, expect, vi } from 'vitest'
import type { MaterializedEvent } from '@/lib/db/canonical-subject-life'
import { groupEventsByCbo, projectCanonicalBusinessObjects } from './canonical-business-object-projection'

// ── Mock Supabase admin ──────────────────────────────────────────────────────

type TableData = Record<string, unknown[]>

function mockAdminClient(tables: TableData) {
  return {
    from: (table: string) => ({
      select: () => ({
        in: () => Promise.resolve({ data: tables[table] ?? [] }),
      }),
    }),
  }
}

let adminMock: ReturnType<typeof mockAdminClient> = mockAdminClient({})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminMock,
}))

function ev(overrides: Partial<MaterializedEvent> & { entityId: string }): MaterializedEvent {
  return {
    entityType: 'site_action',
    proposalId: 'prop-1',
    runId: 'run-1',
    title: 'titre par défaut',
    description: null,
    date: null,
    status: null,
    ...overrides,
  }
}

describe('groupEventsByCbo', () => {
  it('regroupe uniquement les entités partageant le même cboId', () => {
    const events = [ev({ entityId: 'e1' }), ev({ entityId: 'e2' }), ev({ entityId: 'e3' })]
    const memberMap = new Map([
      ['e1', 'cbo-A'],
      ['e2', 'cbo-A'],
      // e3 sans CBO
    ])

    const groups = groupEventsByCbo(events, memberMap)

    expect(groups).toHaveLength(2)
    const grouped = groups.find((g) => g.cboId === 'cbo-A')!
    expect(grouped.members.map((m) => m.entityId)).toEqual(['e1', 'e2'])
    const standalone = groups.find((g) => g.cboId === null)!
    expect(standalone.members.map((m) => m.entityId)).toEqual(['e3'])
  })

  it('ne fusionne jamais deux CBO différents même avec des libellés proches', () => {
    const events = [ev({ entityId: 'e1' }), ev({ entityId: 'e2' })]
    const memberMap = new Map([
      ['e1', 'cbo-largeur'],
      ['e2', 'cbo-epaisseur'],
    ])

    const groups = groupEventsByCbo(events, memberMap)

    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.cboId).sort()).toEqual(['cbo-epaisseur', 'cbo-largeur'])
  })
})

describe('projectCanonicalBusinessObjects', () => {
  it('liste vide → aucune entrée, aucun accès DB', async () => {
    adminMock = mockAdminClient({})
    const result = await projectCanonicalBusinessObjects([])
    expect(result).toEqual([])
  })

  it('FT Matériaux — 7 lignes physiques regroupées en 1 entrée logique', async () => {
    const events = Array.from({ length: 7 }, (_, i) =>
      ev({ entityId: `ft-${i}`, entityType: 'site_action', status: 'open' }),
    )
    adminMock = mockAdminClient({
      canonical_business_object_member: events.map((e) => ({
        member_entity_id: e.entityId,
        canonical_business_object_id: 'cbo-ft',
      })),
      canonical_business_object: [{ id: 'cbo-ft', label: 'Transmettre les fiches techniques' }],
    })

    const result = await projectCanonicalBusinessObjects(events)

    expect(result).toHaveLength(1)
    expect(result[0].isGrouped).toBe(true)
    expect(result[0].label).toBe('Transmettre les fiches techniques')
    expect(result[0].members).toHaveLength(7)
  })

  it('Regard R4 — 2 réserves groupées + 1 échéance isolée → 2 entrées', async () => {
    const reserve1 = ev({ entityId: 'r4-res-1', entityType: 'site_reserve', status: 'open' })
    const reserve2 = ev({ entityId: 'r4-res-2', entityType: 'site_reserve', status: 'open' })
    const deadline = ev({ entityId: 'r4-dl-1', entityType: 'site_deadline', status: 'to_plan' })
    adminMock = mockAdminClient({
      canonical_business_object_member: [
        { member_entity_id: 'r4-res-1', canonical_business_object_id: 'cbo-r4' },
        { member_entity_id: 'r4-res-2', canonical_business_object_id: 'cbo-r4' },
        // deadline sans CBO
      ],
      canonical_business_object: [{ id: 'cbo-r4', label: 'Regard R4 (125x125) chute manquante' }],
    })

    const result = await projectCanonicalBusinessObjects([reserve1, reserve2, deadline])

    expect(result).toHaveLength(2)
    const groupedEntry = result.find((r) => r.isGrouped)!
    expect(groupedEntry.members).toHaveLength(2)
    const standaloneEntry = result.find((r) => !r.isGrouped)!
    expect(standaloneEntry.members[0].entityId).toBe('r4-dl-1')
  })

  it('Enrobage — largeur et épaisseurs restent 2 entrées distinctes (pas de sur-fusion)', async () => {
    const largeur = ev({ entityId: 'enr-largeur-1', entityType: 'site_reserve', status: 'open' })
    const ep1 = ev({ entityId: 'enr-ep-1', entityType: 'site_reserve', status: 'open' })
    const ep2 = ev({ entityId: 'enr-ep-2', entityType: 'site_reserve', status: 'open' })
    const ep3 = ev({ entityId: 'enr-ep-3', entityType: 'site_reserve', status: 'open' })
    adminMock = mockAdminClient({
      canonical_business_object_member: [
        { member_entity_id: 'enr-largeur-1', canonical_business_object_id: 'cbo-largeur' },
        { member_entity_id: 'enr-ep-1', canonical_business_object_id: 'cbo-epaisseur' },
        { member_entity_id: 'enr-ep-2', canonical_business_object_id: 'cbo-epaisseur' },
        { member_entity_id: 'enr-ep-3', canonical_business_object_id: 'cbo-epaisseur' },
      ],
      canonical_business_object: [
        { id: 'cbo-largeur', label: "Largeur de tranchee d'assainissement non conforme" },
        { id: 'cbo-epaisseur', label: "Epaisseurs d'enrobage sur les conduites d'assainissement non conforme" },
      ],
    })

    const result = await projectCanonicalBusinessObjects([largeur, ep1, ep2, ep3])

    expect(result).toHaveLength(2)
    const labels = result.map((r) => r.label).sort()
    expect(labels).toEqual([
      "Epaisseurs d'enrobage sur les conduites d'assainissement non conforme",
      "Largeur de tranchee d'assainissement non conforme",
    ])
  })

  it('statut uniforme conservé ; statut divergent → status null + statusIsDivergent', async () => {
    const uniform = [
      ev({ entityId: 'u1', status: 'open' }),
      ev({ entityId: 'u2', status: 'open' }),
    ]
    const divergent = [
      ev({ entityId: 'd1', status: 'open' }),
      ev({ entityId: 'd2', status: 'done' }),
    ]
    adminMock = mockAdminClient({
      canonical_business_object_member: [
        { member_entity_id: 'u1', canonical_business_object_id: 'cbo-uniform' },
        { member_entity_id: 'u2', canonical_business_object_id: 'cbo-uniform' },
        { member_entity_id: 'd1', canonical_business_object_id: 'cbo-divergent' },
        { member_entity_id: 'd2', canonical_business_object_id: 'cbo-divergent' },
      ],
      canonical_business_object: [
        { id: 'cbo-uniform', label: 'Objet à statut uniforme' },
        { id: 'cbo-divergent', label: 'Objet à statut divergent' },
      ],
    })

    const result = await projectCanonicalBusinessObjects([...uniform, ...divergent])

    const uniformEntry = result.find((r) => r.label === 'Objet à statut uniforme')!
    expect(uniformEntry.status).toBe('open')
    expect(uniformEntry.statusIsDivergent).toBe(false)

    const divergentEntry = result.find((r) => r.label === 'Objet à statut divergent')!
    expect(divergentEntry.status).toBeNull()
    expect(divergentEntry.statusIsDivergent).toBe(true)
  })

  it('les membres physiques restent accessibles derrière l’objet durable (aucune perte de données)', async () => {
    const events = [
      ev({ entityId: 'e1', title: 'Occurrence PV3' }),
      ev({ entityId: 'e2', title: 'Occurrence PV5' }),
    ]
    adminMock = mockAdminClient({
      canonical_business_object_member: [
        { member_entity_id: 'e1', canonical_business_object_id: 'cbo-x' },
        { member_entity_id: 'e2', canonical_business_object_id: 'cbo-x' },
      ],
      canonical_business_object: [{ id: 'cbo-x', label: 'Identité durable X' }],
    })

    const result = await projectCanonicalBusinessObjects(events)

    expect(result).toHaveLength(1)
    expect(result[0].members.map((m) => m.title)).toEqual(['Occurrence PV3', 'Occurrence PV5'])
  })
})
