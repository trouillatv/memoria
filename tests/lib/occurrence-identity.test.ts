// PL3-0a — L'IDENTITÉ d'une occurrence, prouvée contre la VRAIE base.
//
// Le contrat que le code tient déjà (`occurrenceKey`, lib/planning/projection.ts) :
//
//     template_id | scheduled_for | slot        ← UNE occurrence
//     … et deux `slot = NULL`, c'est le MÊME créneau ('∅' dans la clé).
//
// Le contrat que la BASE tenait avant la migration 198 : l'index unique était en
// `NULLS DISTINCT` (défaut Postgres) — deux lignes `(template, date, NULL)`
// étaient donc TOUTES DEUX acceptées. Le code et la base divergeaient.
//
// ⚠️ CE FICHIER EST LA PREUVE DU BUG. Avant la migration 198, le test
// « deux occurrences identiques avec slot NULL » ÉCHOUE (deux lignes créées).
// Après, il passe. C'est exactement pour cela qu'il est écrit AVANT elle.
//
// Test d'INTÉGRATION (vraie Supabase) → déclaré dans tests/integration-tests.ts,
// donc HORS CI. Il nettoie tout ce qu'il crée.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildScheduledAt } from '@/lib/time/prestation-slot'
import type { InterventionSlot } from '@/types/db'

const TAG = `__test_pl30a_${Date.now()}__`

let clientId: string
let siteId: string
let missionId: string
let templateId: string
let orgId: string | null = null
const createdInterventionIds: string[] = []

beforeAll(async () => {
  const db = createAdminClient()

  // Une organisation réelle (les objets orphelins sont refusés partout).
  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  orgId = (org as { id: string } | null)?.id ?? null
  if (!orgId) throw new Error('Aucune organisation en base — impossible de tester')

  const { data: client, error: cErr } = await db
    .from('clients')
    .insert({ name: `${TAG}client`, organization_id: orgId })
    .select('id')
    .single()
  if (cErr) throw cErr
  clientId = (client as { id: string }).id

  const { data: site, error: sErr } = await db
    .from('sites')
    .insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId })
    .select('id')
    .single()
  if (sErr) throw sErr
  siteId = (site as { id: string }).id

  const { data: mission, error: mErr } = await db
    .from('missions')
    .insert({ name: `${TAG}mission`, site_id: siteId, cadence: 'daily', organization_id: orgId })
    .select('id')
    .single()
  if (mErr) throw mErr
  missionId = (mission as { id: string }).id

  // Un rythme SANS heure et SANS créneau → ses occurrences ont `slot = NULL`.
  // C'est précisément le cas que l'index ne protégeait pas.
  const { data: tpl, error: tErr } = await db
    .from('intervention_templates')
    .insert({
      mission_id: missionId,
      title: `${TAG}template`,
      frequency: 'daily',
      starts_on: '2026-07-01',
    })
    .select('id')
    .single()
  if (tErr) throw tErr
  templateId = (tpl as { id: string }).id
})

afterAll(async () => {
  const db = createAdminClient()
  if (createdInterventionIds.length > 0) {
    await db.from('interventions').delete().in('id', createdInterventionIds)
  }
  if (templateId) await db.from('intervention_templates').delete().eq('id', templateId)
  if (missionId) await db.from('missions').delete().eq('id', missionId)
  if (siteId) await db.from('sites').delete().eq('id', siteId)
  if (clientId) await db.from('clients').delete().eq('id', clientId)
})

/** Insère une occurrence brute. Renvoie l'id, ou l'erreur Postgres. */
async function insertOccurrence(scheduledFor: string, slot: string | null) {
  const db = createAdminClient()
  const res = await db
    .from('interventions')
    .insert({
      mission_id: missionId,
      template_id: templateId,
      scheduled_for: scheduledFor,
      scheduled_at: buildScheduledAt(scheduledFor, slot as InterventionSlot | null),
      slot,
      status: 'planned',
      organization_id: orgId,
    })
    .select('id')
    .maybeSingle()
  const id = (res.data as { id: string } | null)?.id
  if (id) createdInterventionIds.push(id)
  return res
}

describe('PL3-0a — l’identité d’une occurrence est tenue PAR LA BASE', () => {
  it('deux occurrences identiques avec un CRÉNEAU → la seconde est refusée', async () => {
    const date = '2026-07-02'
    const first = await insertOccurrence(date, 'morning')
    expect(first.error).toBeNull()

    const second = await insertOccurrence(date, 'morning')
    expect(second.error).not.toBeNull()
    expect(second.error?.code).toBe('23505') // violation d'unicité
  })

  it('LA PREUVE — deux occurrences identiques avec slot NULL → la seconde DOIT être refusée', async () => {
    // ⚠️ AVANT la migration 198, ce test ÉCHOUE : Postgres traite deux NULL
    // comme DISTINCTS, les deux lignes sont créées, et l'idempotence de toute
    // matérialisation à la demande serait FAUSSE.
    const date = '2026-07-03'
    const first = await insertOccurrence(date, null)
    expect(first.error).toBeNull()

    const second = await insertOccurrence(date, null)
    expect(second.error).not.toBeNull()
    expect(second.error?.code).toBe('23505')

    // Et une seule ligne subsiste réellement.
    const db = createAdminClient()
    const { count } = await db
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('template_id', templateId)
      .eq('scheduled_for', date)
      .is('slot', null)
    expect(count).toBe(1)
  })

  it('des CRÉNEAUX différents le même jour restent DEUX occurrences distinctes', async () => {
    const date = '2026-07-04'
    const matin = await insertOccurrence(date, 'morning')
    const soir = await insertOccurrence(date, 'evening')
    expect(matin.error).toBeNull()
    expect(soir.error).toBeNull() // deux prestations réelles : pas un doublon
  })

  it('des JOURS différents restent deux occurrences distinctes', async () => {
    const a = await insertOccurrence('2026-07-05', null)
    const b = await insertOccurrence('2026-07-06', null)
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
  })
})
