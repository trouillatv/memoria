// Test d'INTÉGRATION (vraie Supabase) — P0 SECURITY : périmètre chantier field
// unifié (mandat Vincent 2026-10-02, cf. doctrine dans lib/auth/site-scope.ts).
//
// Scénario miroir du cas réel (Manu Kotra) :
//   · SITE_A appartient à ORG_A — l'utilisateur y est membre ACTIF, son équipe
//     ACTIVE y a une mission assignée → accessible aujourd'hui.
//   · SITE_B appartient à ORG_B — aucune appartenance, aucune équipe, aucune
//     mission actuelle pour cet utilisateur → inaccessible aujourd'hui.
//   · Une intervention PASSÉE sur SITE_B cite encore l'utilisateur dans le
//     tableau legacy `interventions.team[]` — exactement comme les 9 lignes
//     BatiSud de juin 2026 qui citaient Manu après son départ.
//
// Preuve exigée (sections 5 et 6 du mandat) :
//   · listAccessibleSiteIdsForUser ne rend JAMAIS SITE_B, même cross-org ;
//   · listInterventionsVisibleToUser ne renvoie AUCUNE intervention de SITE_B ;
//   · perdre la SEULE équipe active retombe sur `[]`, jamais sur le fallback
//     legacy `interventions.team[]` qui citerait toujours l'utilisateur.
//
// La preuve du côté écriture (ensureTodayInterventionsForSites, backfill
// assigned_team_id dans app/(field)/m/page.tsx) est structurelle : ces deux
// chemins ne reçoivent QUE agentSiteIds, lui-même QUE le retour de
// listAccessibleSiteIdsForUser (cf. page.tsx) — donc ce test, en prouvant que
// ce retour exclut SITE_B, prouve par construction qu'aucune écriture ne peut
// l'atteindre. ensureTodayInterventionsForSites lui-même n'opère que sur les
// sites explicitement reçus (lib/recurrence/ensure-today.ts), sans requête
// cross-site — nul besoin de le ré-exercer ici.
//
// Déclaré dans tests/integration-tests.ts. Nettoyage complet en afterAll.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { listAccessibleSiteIdsForUser } from '@/lib/auth/site-scope'
import { listInterventionsVisibleToUser } from '@/lib/db/interventions'
import { addMemberToTeam } from '@/lib/db/teams'

const TAG = `__test_field_site_scope_sec_${Math.floor(Date.now() / 1000)}__`
const TEST_USER_EMAIL = `${TAG}user@example.test`

let orgAId: string
let orgBId: string
let clientAId: string
let clientBId: string
let siteAId: string
let siteBId: string
let teamAId: string
let missionAId: string
let missionBId: string
let userId: string
let orgMembershipId: string
let legacyInterventionId: string

beforeAll(async () => {
  const db = createAdminClient()

  const { data: created, error: userError } = await db.auth.admin.createUser({
    email: TEST_USER_EMAIL,
    password: 'TestFieldScopeSec!2026',
    email_confirm: true,
    user_metadata: { full_name: 'Test Field Scope Security', role: 'chef_equipe' },
  })
  if (userError) throw userError
  userId = created.user!.id

  orgAId = (
    await db.from('organizations').insert({ name: `${TAG}orgA`, slug: `${TAG}org-a`.toLowerCase() }).select('id').single()
  ).data!.id as string
  orgBId = (
    await db.from('organizations').insert({ name: `${TAG}orgB`, slug: `${TAG}org-b`.toLowerCase() }).select('id').single()
  ).data!.id as string

  clientAId = (await db.from('clients').insert({ name: `${TAG}clientA`, organization_id: orgAId }).select('id').single())
    .data!.id as string
  clientBId = (await db.from('clients').insert({ name: `${TAG}clientB`, organization_id: orgBId }).select('id').single())
    .data!.id as string

  siteAId = (
    await db.from('sites').insert({ name: `${TAG}siteA`, client_id: clientAId, organization_id: orgAId }).select('id').single()
  ).data!.id as string
  siteBId = (
    await db.from('sites').insert({ name: `${TAG}siteB`, client_id: clientBId, organization_id: orgBId }).select('id').single()
  ).data!.id as string

  teamAId = (
    await db.from('teams').insert({ name: `${TAG}teamA`.slice(0, 50), organization_id: orgAId }).select('id').single()
  ).data!.id as string

  missionAId = (
    await db
      .from('missions')
      .insert({ site_id: siteAId, name: `${TAG} mission A`, organization_id: orgAId, assigned_team_id: teamAId })
      .select('id')
      .single()
  ).data!.id as string
  missionBId = (
    await db.from('missions').insert({ site_id: siteBId, name: `${TAG} mission B`, organization_id: orgBId }).select('id').single()
  ).data!.id as string

  // L'utilisateur est membre ACTIF de ORG_A aujourd'hui — comme Manu après son
  // déplacement vers Archi13 — Démonstration. Aucune appartenance à ORG_B.
  orgMembershipId = (
    await db
      .from('organization_memberships')
      .insert({ user_id: userId, organization_id: orgAId, role: 'chef_equipe', status: 'active' })
      .select('id')
      .single()
  ).data!.id as string

  await addMemberToTeam(teamAId, userId)

  // La trace legacy : une intervention PASSÉE sur SITE_B (donc ORG_B) qui cite
  // encore l'utilisateur dans interventions.team[] — exactement comme les 9
  // lignes BatiSud de juin 2026 citant Manu après son départ.
  legacyInterventionId = (
    await db
      .from('interventions')
      .insert({
        mission_id: missionBId,
        scheduled_at: new Date().toISOString(),
        status: 'planned',
        team: [userId],
      })
      .select('id')
      .single()
  ).data!.id as string
})

afterAll(async () => {
  const db = createAdminClient()
  if (legacyInterventionId) await db.from('interventions').delete().eq('id', legacyInterventionId)
  await db.from('missions').delete().in('id', [missionAId, missionBId])
  if (teamAId) await db.from('team_members').delete().eq('team_id', teamAId).eq('user_id', userId)
  if (teamAId) await db.from('teams').delete().eq('id', teamAId)
  if (orgMembershipId) await db.from('organization_memberships').delete().eq('id', orgMembershipId)
  await db.from('sites').delete().in('id', [siteAId, siteBId])
  await db.from('clients').delete().in('id', [clientAId, clientBId])
  await db.from('organizations').delete().in('id', [orgAId, orgBId])
  if (userId) await db.auth.admin.deleteUser(userId)
})

describe('P0 SECURITY — périmètre chantier field unifié (mandat 2026-10-02)', () => {
  it('Section 6 (golden cross-org) : listAccessibleSiteIdsForUser ne rend QUE SITE_A, jamais SITE_B malgré interventions.team legacy', async () => {
    const siteIds = await listAccessibleSiteIdsForUser({ id: userId, role: 'chef_equipe' })
    expect(siteIds).toEqual([siteAId])
  })

  it('Section 6 : listInterventionsVisibleToUser ne renvoie AUCUNE intervention de SITE_B malgré team[] legacy', async () => {
    const interventions = await listInterventionsVisibleToUser(userId)
    expect(interventions.some((i) => i.id === legacyInterventionId)).toBe(false)
    expect(interventions.every((i) => i.mission_id !== missionBId)).toBe(true)
  })

  it('Section 5 (écriture) : perdre la SEULE équipe active retombe sur [], jamais sur le fallback legacy team[]', async () => {
    const db = createAdminClient()
    await db.from('team_members').update({ left_at: new Date().toISOString() }).eq('team_id', teamAId).eq('user_id', userId)

    try {
      // Si le fallback legacy existait encore, SITE_B réapparaîtrait ici (le
      // tableau interventions.team du test cite toujours l'utilisateur).
      const siteIds = await listAccessibleSiteIdsForUser({ id: userId, role: 'chef_equipe' })
      expect(siteIds).toEqual([])

      const interventions = await listInterventionsVisibleToUser(userId)
      expect(interventions).toEqual([])
    } finally {
      // Remise en état pour ne pas fausser un afterAll ou un test ultérieur.
      await db.from('team_members').update({ left_at: null }).eq('team_id', teamAId).eq('user_id', userId)
    }
  })
})
