// Test d'INTÉGRATION (vraie Supabase) — PLAN-INTEG-1 FINAL ATOMIC SWITCH FIX
// (review ChatGPT du SHA f564aa298f47335a7f62ffb4a5a14206aa9834f3), migration 444.
//
// Prouve que la réécriture en place (fn_plan_save_published_cycle_exclusive) et le
// version-split (fn_plan_supersede_cycle_exclusive) d'un roulement DÉJÀ PUBLIÉ sont
// des transactions Postgres UNIQUES : un échec à n'importe quelle étape — ici forcé
// par une équipe fantôme qui viole la FK `planning_cycle_slots.team_id` — laisse
// l'ancien roulement STRICTEMENT intact, y compris les mutations qui précèdent
// l'échec DANS LE MÊME appel RPC (updateCycle-puis-RPC ou deux RPC séparés ne
// prouveraient rien : seul un rollback Postgres réel le prouve).
//
// Les tests 2 et 5 appellent la RPC DIRECTEMENT via createAdminClient().rpc(...),
// en contournant le wrapper JS (`savePublishedCycleAtomic`/`supersedeCyclePublishedAtomic`) :
// leur préflight `assertTeamsCompatible` rejetterait l'équipe fantôme AVANT même
// que la RPC ne démarre, ce qui n'exercerait jamais le rollback transactionnel réel.
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createCycle,
  getCycle,
  savePublishedCycleAtomic,
  supersedeCyclePublishedAtomic,
  type CycleSlot,
} from '@/lib/db/planning-cycles'

const TAG = `__test_plan_integ_1_atomic_${Math.floor(Date.now() / 1000)}__`

let orgId: string
let clientId: string
let siteId: string
let teamAId: string
let teamBId: string
// N'existe JAMAIS dans `teams` — force une violation de FK réelle sur
// `planning_cycle_slots.team_id`, à l'intérieur même de la transaction RPC.
const ghostTeamId = randomUUID()

let missionRewriteAId: string
let missionRewriteBId: string
let missionSupersedeId: string
let missionConflictId: string
let missionRollbackId: string

function slot(teamId: string, overrides: Partial<CycleSlot> = {}): CycleSlot {
  return { weekIndex: 0, weekday: 1, teamId, state: 'work', startTime: '08:00', endTime: '12:00', ...overrides }
}

async function activeTemplatesCount(cycleId: string): Promise<number> {
  const db = createAdminClient()
  const { count } = await db
    .from('intervention_templates')
    .select('*', { count: 'exact', head: true })
    .eq('cycle_id', cycleId)
    .eq('active', true)
    .is('deleted_at', null)
  return count ?? 0
}

beforeAll(async () => {
  const db = createAdminClient()
  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id

  clientId = (
    await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()
  ).data!.id as string
  siteId = (
    await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()
  ).data!.id as string

  teamAId = (
    await db.from('teams').insert({ name: `${TAG}teamA`.slice(0, 50), organization_id: orgId }).select('id').single()
  ).data!.id as string
  teamBId = (
    await db.from('teams').insert({ name: `${TAG}teamB`.slice(0, 50), organization_id: orgId }).select('id').single()
  ).data!.id as string

  const insertMission = async (name: string): Promise<string> =>
    (await db.from('missions').insert({ site_id: siteId, name, organization_id: orgId }).select('id').single())
      .data!.id as string

  missionRewriteAId = await insertMission(`${TAG} mission rewrite A`)
  missionRewriteBId = await insertMission(`${TAG} mission rewrite B`)
  missionSupersedeId = await insertMission(`${TAG} mission supersede`)
  missionConflictId = await insertMission(`${TAG} mission conflict`)
  missionRollbackId = await insertMission(`${TAG} mission rollback`)
})

afterAll(async () => {
  const db = createAdminClient()
  // Cascade : planning_cycle_slots (cycle_id) + intervention_templates (cycle_id).
  await db.from('planning_cycles').delete().eq('site_id', siteId)
  // Le SIMPLE brut du test 4 n'a pas de cycle_id, donc pas emporté par la cascade.
  await db.from('intervention_templates').delete().eq('mission_id', missionConflictId).is('cycle_id', null)
  await db.from('missions').delete().eq('site_id', siteId)
  await db.from('teams').delete().in('id', [teamAId, teamBId])
  await db.from('sites').delete().eq('id', siteId)
  await db.from('clients').delete().eq('id', clientId)
})

describe('PLAN-INTEG-1 — bascule atomique d’un roulement déjà publié (mig 444)', () => {
  it('1. réécriture publiée + succès → état final correct, projections régénérées', async () => {
    const cycleId = await createCycle({
      siteId,
      missionId: missionRewriteAId,
      organizationId: orgId,
      name: `${TAG} v1`,
      cycleLengthWeeks: 1,
      anchorDate: '2026-01-05',
      startsOn: '2026-01-05',
      endsOn: null,
      slots: [slot(teamAId)],
      userId: null,
      status: 'published',
    })

    const result = await savePublishedCycleAtomic({
      cycleId,
      payload: {
        siteId,
        missionId: missionRewriteAId,
        organizationId: orgId,
        name: `${TAG} v1 réécrit`,
        cycleLengthWeeks: 1,
        anchorDate: '2026-01-05',
        startsOn: '2026-01-05',
        endsOn: null,
        slots: [slot(teamBId, { weekday: 2, startTime: '09:00', endTime: '13:00' })],
        userId: null,
        status: 'published',
      },
      confirmReplaceSimple: true,
      actorId: null,
    })

    expect(result).toEqual({ ok: true })

    const updated = await getCycle(cycleId)
    expect(updated?.name).toBe(`${TAG} v1 réécrit`)
    expect(updated?.slots).toEqual([
      { weekIndex: 0, weekday: 2, teamId: teamBId, state: 'work', startTime: '09:00', endTime: '13:00' },
    ])
    expect(await activeTemplatesCount(cycleId)).toBe(1)

    const db = createAdminClient()
    const { data: tpl } = await db
      .from('intervention_templates')
      .select('assigned_team_id, day_of_week')
      .eq('cycle_id', cycleId)
      .eq('active', true)
      .single()
    expect((tpl as { assigned_team_id: string }).assigned_team_id).toBe(teamBId)
    expect((tpl as { day_of_week: number }).day_of_week).toBe(2)
  })

  it('2. réécriture publiée + échec injecté (équipe fantôme) → ancien roulement strictement intact', async () => {
    const cycleId = await createCycle({
      siteId,
      missionId: missionRewriteBId,
      organizationId: orgId,
      name: `${TAG} v2`,
      cycleLengthWeeks: 1,
      anchorDate: '2026-02-02',
      startsOn: '2026-02-02',
      endsOn: null,
      slots: [slot(teamAId)],
      userId: null,
      status: 'published',
    })
    const before = await getCycle(cycleId)
    const activeBefore = await activeTemplatesCount(cycleId)

    const db = createAdminClient()
    const { error } = await db.rpc('fn_plan_save_published_cycle_exclusive', {
      p_cycle_id: cycleId,
      p_name: `${TAG} v2 corrompu`,
      p_cycle_length_weeks: 2,
      p_anchor_date: '2026-02-02',
      p_starts_on: '2026-02-02',
      p_ends_on: null,
      p_mission_id: missionRewriteBId,
      p_slots: [{ weekIndex: 0, weekday: 3, teamId: ghostTeamId, state: 'work', startTime: null, endTime: null }],
      p_confirm_replace_simple: true,
      p_actor_id: null,
    })

    expect(error).not.toBeNull()

    // L'UPDATE planning_cycles ET le DELETE des cases précédaient l'échec dans la
    // MÊME transaction : s'ils avaient survécu, ceci le révélerait.
    const after = await getCycle(cycleId)
    expect(after).toEqual(before)
    expect(await activeTemplatesCount(cycleId)).toBe(activeBefore)
  })

  it('3. version-split publié + succès → ancienne version bornée, nouvelle publiée', async () => {
    const oldCycleId = await createCycle({
      siteId,
      missionId: missionSupersedeId,
      organizationId: orgId,
      name: `${TAG} supersede v1`,
      cycleLengthWeeks: 1,
      anchorDate: '2026-01-05',
      startsOn: '2026-01-05',
      endsOn: null,
      slots: [slot(teamAId)],
      userId: null,
      status: 'published',
    })

    const result = await supersedeCyclePublishedAtomic({
      oldCycleId,
      effectiveFrom: '2026-06-01',
      payload: {
        siteId,
        missionId: missionSupersedeId,
        organizationId: orgId,
        name: `${TAG} supersede v2`,
        cycleLengthWeeks: 1,
        anchorDate: '2026-06-01',
        startsOn: '2026-06-01',
        endsOn: null,
        slots: [slot(teamBId)],
        userId: null,
        status: 'published',
      },
      confirmReplaceSimple: true,
      actorId: null,
    })

    expect(result).toEqual({ ok: true, cycleId: expect.any(String) })
    const newCycleId = (result as { ok: true; cycleId: string }).cycleId

    const old = await getCycle(oldCycleId)
    expect(old?.endsOn).toBe('2026-05-31')

    const next = await getCycle(newCycleId)
    expect(next?.status).toBe('published')
    expect(next?.startsOn).toBe('2026-06-01')
    expect(next?.supersedesCycleId).toBe(oldCycleId)
    expect(await activeTemplatesCount(newCycleId)).toBe(1)
  })

  it('4. version-split publié + SIMPLE concurrent + confirm=true → bascule complète, zéro hybride', async () => {
    const oldCycleId = await createCycle({
      siteId,
      missionId: missionConflictId,
      organizationId: orgId,
      name: `${TAG} conflict v1`,
      cycleLengthWeeks: 1,
      anchorDate: '2026-01-05',
      startsOn: '2026-01-05',
      endsOn: '2026-02-28', // borné : ne chevauche pas encore le futur SIMPLE
      slots: [slot(teamAId)],
      userId: null,
      status: 'published',
    })

    const db = createAdminClient()
    const { data: simple } = await db
      .from('intervention_templates')
      .insert({
        mission_id: missionConflictId,
        organization_id: orgId,
        title: `${TAG} simple concurrent`,
        frequency: 'weekly',
        day_of_week: 1,
        starts_on: '2026-03-15',
        ends_on: null,
        active: true,
      })
      .select('id')
      .single()
    const simpleId = (simple as { id: string }).id

    const result = await supersedeCyclePublishedAtomic({
      oldCycleId,
      effectiveFrom: '2026-03-05', // borne l'ancienne à 2026-03-04, avant le SIMPLE (03-15)
      payload: {
        siteId,
        missionId: missionConflictId,
        organizationId: orgId,
        name: `${TAG} conflict v2`,
        cycleLengthWeeks: 1,
        anchorDate: '2026-03-05',
        startsOn: '2026-03-05',
        endsOn: null, // chevauche le SIMPLE (03-15, sans fin)
        slots: [slot(teamAId)],
        userId: null,
        status: 'published',
      },
      confirmReplaceSimple: true,
      actorId: null,
    })

    expect(result).toEqual({ ok: true, cycleId: expect.any(String) })
    const newCycleId = (result as { ok: true; cycleId: string }).cycleId

    const old = await getCycle(oldCycleId)
    expect(old?.endsOn).toBe('2026-03-04')

    const next = await getCycle(newCycleId)
    expect(next?.status).toBe('published')

    const { data: simpleAfter } = await db
      .from('intervention_templates')
      .select('active, deleted_at')
      .eq('id', simpleId)
      .single()
    expect((simpleAfter as { active: boolean }).active).toBe(false)
    expect((simpleAfter as { deleted_at: string | null }).deleted_at).not.toBeNull()
  })

  it('5. version-split publié + échec injecté (équipe fantôme) → ancien intact, aucun successeur persistant', async () => {
    const oldCycleId = await createCycle({
      siteId,
      missionId: missionRollbackId,
      organizationId: orgId,
      name: `${TAG} rollback v1`,
      cycleLengthWeeks: 1,
      anchorDate: '2026-01-05',
      startsOn: '2026-01-05',
      endsOn: null,
      slots: [slot(teamAId)],
      userId: null,
      status: 'published',
    })
    const before = await getCycle(oldCycleId)
    const activeBefore = await activeTemplatesCount(oldCycleId)

    const db = createAdminClient()
    const { error } = await db.rpc('fn_plan_supersede_cycle_exclusive', {
      p_old_cycle_id: oldCycleId,
      p_effective_from: '2026-04-01',
      p_site_id: siteId,
      p_mission_id: missionRollbackId,
      p_organization_id: orgId,
      p_name: `${TAG} rollback v2`,
      p_cycle_length_weeks: 1,
      p_anchor_date: '2026-04-01',
      p_ends_on: null,
      p_slots: [{ weekIndex: 0, weekday: 1, teamId: ghostTeamId, state: 'work', startTime: null, endTime: null }],
      p_confirm_replace_simple: true,
      p_actor_id: null,
    })

    expect(error).not.toBeNull()

    // L'UPDATE de clôture de l'ancienne version, sa régénération, ET l'INSERT de
    // la ligne successeur précédaient l'échec dans la MÊME transaction.
    const after = await getCycle(oldCycleId)
    expect(after).toEqual(before)
    expect(await activeTemplatesCount(oldCycleId)).toBe(activeBefore)

    const { count: successorCount } = await db
      .from('planning_cycles')
      .select('*', { count: 'exact', head: true })
      .eq('supersedes_cycle_id', oldCycleId)
    expect(successorCount ?? 0).toBe(0)
  })
})
