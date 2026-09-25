// Test d'INTÉGRATION (vraie Supabase) — FIX_REQUIRED review ChatGPT sur c05469a7,
// migration 441.
//
// Prouve que « Traiter un point » (Action + rapprochement P0-4B + qualification
// P0-4C) est ATOMIQUE via la RPC fn_create_action_from_engagement_point : succès
// → exactement 1 Action + 1 lien + 1 événement ; échec à N'IMPORTE QUELLE étape
// interne (qualification hors des 4 valeurs P0-4C, Engagement non actif,
// site_id incohérent) → rollback INTÉGRAL, 0/0/0. Jamais d'Action orpheline,
// jamais de compensation par DELETE.
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'node:crypto'
import { createActionFromEngagementPoint } from '@/lib/db/site-action-engagement-links'

const TAG = `__test_treat_point_atomic_${Math.floor(Date.now() / 1000)}__`

let orgId: string, clientId: string, siteId: string, otherSiteId: string, engagementId: string

async function insertActiveEngagement(status: 'active' | 'curated' = 'active') {
  const db = createAdminClient()
  const { data, error } = await db
    .from('engagements')
    .insert({
      tender_id: null,
      contract_id: null,
      site_id: siteId,
      source_document_id: null,
      page_number: null,
      source_type: 'manual',
      source_excerpt: `${TAG} excerpt`,
      source_ref: null,
      category: 'frequency',
      kind: 'objectif',
      short_label: `${TAG} engagement`,
      measurable: false,
      ai_confidence: null,
      status,
      organization_id: orgId,
    })
    .select('id')
    .single()
  if (error) throw error
  return data!.id as string
}

const countActions = async () => {
  const db = createAdminClient()
  const { count } = await db.from('site_actions').select('*', { count: 'exact', head: true }).eq('site_id', siteId).ilike('title', `${TAG}%`)
  return count ?? 0
}
const countLinks = async (engId: string) => {
  const db = createAdminClient()
  const { count } = await db.from('site_action_engagement_links').select('*', { count: 'exact', head: true }).eq('engagement_id', engId)
  return count ?? 0
}
const countEvents = async (engId: string) => {
  const db = createAdminClient()
  const { data: links } = await db.from('site_action_engagement_links').select('id').eq('engagement_id', engId)
  const linkIds = (links ?? []).map((l) => l.id as string)
  if (linkIds.length === 0) return 0
  const { count } = await db.from('site_action_engagement_link_events').select('*', { count: 'exact', head: true }).in('link_id', linkIds)
  return count ?? 0
}

beforeAll(async () => {
  const db = createAdminClient()
  const { data: org } = await db.from('organizations').select('id').limit(1).maybeSingle()
  if (!org) throw new Error('Aucune organisation — seed requis')
  orgId = (org as { id: string }).id
  clientId = (await db.from('clients').insert({ name: `${TAG}client`, organization_id: orgId }).select('id').single()).data!.id as string
  siteId = (await db.from('sites').insert({ name: `${TAG}site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
  otherSiteId = (await db.from('sites').insert({ name: `${TAG}other-site`, client_id: clientId, organization_id: orgId }).select('id').single()).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  await db.from('site_action_engagement_link_events').delete().eq('organization_id', orgId).ilike('note', `${TAG}%`)
  const { data: acts } = await db.from('site_actions').select('id').eq('site_id', siteId).ilike('title', `${TAG}%`)
  const actIds = (acts ?? []).map((a) => a.id as string)
  if (actIds.length > 0) {
    await db.from('site_action_engagement_links').delete().in('site_action_id', actIds)
    await db.from('site_actions').delete().in('id', actIds)
  }
  await db.from('engagements').delete().eq('site_id', siteId)
  await db.from('sites').delete().in('id', [siteId, otherSiteId])
  await db.from('clients').delete().eq('id', clientId)
})

describe('fn_create_action_from_engagement_point — atomicité (migration 441)', () => {
  it('1. succès : exactement 1 Action + 1 lien + 1 événement', async () => {
    engagementId = await insertActiveEngagement('active')

    const result = await createActionFromEngagementPoint({
      engagementId,
      siteId,
      organizationId: orgId,
      title: `${TAG} action succès`,
      qualification: 'demande_evolution',
      note: `${TAG} note`,
      createdBy: null,
    })

    expect(result.ok).toBe(true)
    expect(await countLinks(engagementId)).toBe(1)
    expect(await countEvents(engagementId)).toBe(1)
  })

  it('2. qualification hors des 4 valeurs P0-4C (CHECK) : rollback intégral — 0 Action / 0 lien / 0 événement', async () => {
    const engId = await insertActiveEngagement('active')
    const before = await countActions()

    const result = await createActionFromEngagementPoint({
      engagementId: engId,
      siteId,
      organizationId: orgId,
      title: `${TAG} action qualif invalide`,
      // @ts-expect-error — valeur volontairement hors des 4 valeurs P0-4C, pour prouver le rollback CHECK
      qualification: 'conforme',
      note: null,
      createdBy: null,
    })

    expect(result.ok).toBe(false)
    expect(await countActions()).toBe(before) // aucune Action ajoutée (l'insert précédent a été rollback lui aussi)
    expect(await countLinks(engId)).toBe(0)
    expect(await countEvents(engId)).toBe(0)
  })

  it('3. Engagement non actif (curated) : refuse avant tout insert — 0/0/0', async () => {
    const engId = await insertActiveEngagement('curated')
    const before = await countActions()

    const result = await createActionFromEngagementPoint({
      engagementId: engId,
      siteId,
      organizationId: orgId,
      title: `${TAG} action non active`,
      qualification: 'mise_en_oeuvre',
      note: null,
      createdBy: null,
    })

    expect(result.ok).toBe(false)
    expect(await countActions()).toBe(before)
    expect(await countLinks(engId)).toBe(0)
    expect(await countEvents(engId)).toBe(0)
  })

  it('4. site_id incohérent avec l\'engagement : refuse avant tout insert — 0/0/0', async () => {
    const engId = await insertActiveEngagement('active')
    const before = await countActions()

    const result = await createActionFromEngagementPoint({
      engagementId: engId,
      siteId: otherSiteId, // engagement réellement rattaché à siteId, pas otherSiteId
      organizationId: orgId,
      title: `${TAG} action site incohérent`,
      qualification: 'ecart_a_examiner',
      note: null,
      createdBy: null,
    })

    expect(result.ok).toBe(false)
    expect(await countActions()).toBe(before)
    expect(await countLinks(engId)).toBe(0)
    expect(await countEvents(engId)).toBe(0)
  })

  it('5. Engagement inexistant : refuse, aucune écriture', async () => {
    const ghost = randomUUID()
    const before = await countActions()

    const result = await createActionFromEngagementPoint({
      engagementId: ghost,
      siteId,
      organizationId: orgId,
      title: `${TAG} action fantôme`,
      qualification: 'clarification',
      note: null,
      createdBy: null,
    })

    expect(result.ok).toBe(false)
    expect(await countActions()).toBe(before)
  })
})
