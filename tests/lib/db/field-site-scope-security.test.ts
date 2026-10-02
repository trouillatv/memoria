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
    const siteIds = await listAccessibleSiteIdsForUser({ id: userId })
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
      const siteIds = await listAccessibleSiteIdsForUser({ id: userId })
      expect(siteIds).toEqual([])

      const interventions = await listInterventionsVisibleToUser(userId)
      expect(interventions).toEqual([])
    } finally {
      // Remise en état pour ne pas fausser un afterAll ou un test ultérieur.
      await db.from('team_members').update({ left_at: null }).eq('team_id', teamAId).eq('user_id', userId)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Point 5 du mandat (2026-10-02) — CAS A/B/C + organisation_id legacy sans
// appartenance active. Fixtures PROPRES, isolées de la série ci-dessus (pas
// de mutation partagée d'un `team_members` déjà exercé par un autre test).
// ───────────────────────────────────────────────────────────────────────────

const TAG2 = `__test_field_scope_sec2_${Math.floor(Date.now() / 1000)}__`

describe('P0 SECURITY — CAS A/B/C (Point 5 du mandat 2026-10-02)', () => {
  let orgAId2: string
  let orgBId2: string
  let clientAId2: string
  let clientBId2: string
  let siteAId2: string
  let siteBId2: string
  let siteCId2: string
  let siteDId2: string
  let siteEId2: string
  let teamAId2: string
  let teamBStaleId2: string
  let teamCArchivedId2: string
  let teamDId2: string
  const missionIds: string[] = []
  let userCasAId: string
  let userCasBId: string
  let userCasCId: string
  let userLegacyOrgId: string
  const membershipIds: string[] = []

  beforeAll(async () => {
    const db = createAdminClient()

    const mkUser = async (email: string) => {
      const { data, error } = await db.auth.admin.createUser({
        email,
        password: 'TestFieldScopeSec2!2026',
        email_confirm: true,
        user_metadata: { full_name: email, role: 'chef_equipe' },
      })
      if (error) throw error
      return data.user!.id
    }
    userCasAId = await mkUser(`${TAG2}casa@example.test`)
    userCasBId = await mkUser(`${TAG2}casb@example.test`)
    userCasCId = await mkUser(`${TAG2}casc@example.test`)
    userLegacyOrgId = await mkUser(`${TAG2}legacy@example.test`)

    orgAId2 = (await db.from('organizations').insert({ name: `${TAG2}orgA`, slug: `${TAG2}org-a`.toLowerCase() }).select('id').single()).data!.id as string
    orgBId2 = (await db.from('organizations').insert({ name: `${TAG2}orgB`, slug: `${TAG2}org-b`.toLowerCase() }).select('id').single()).data!.id as string

    clientAId2 = (await db.from('clients').insert({ name: `${TAG2}clientA`, organization_id: orgAId2 }).select('id').single()).data!.id as string
    clientBId2 = (await db.from('clients').insert({ name: `${TAG2}clientB`, organization_id: orgBId2 }).select('id').single()).data!.id as string

    siteAId2 = (await db.from('sites').insert({ name: `${TAG2}siteA`, client_id: clientAId2, organization_id: orgAId2 }).select('id').single()).data!.id as string
    siteBId2 = (await db.from('sites').insert({ name: `${TAG2}siteB`, client_id: clientBId2, organization_id: orgBId2 }).select('id').single()).data!.id as string
    siteCId2 = (await db.from('sites').insert({ name: `${TAG2}siteC`, client_id: clientBId2, organization_id: orgBId2 }).select('id').single()).data!.id as string
    siteDId2 = (await db.from('sites').insert({ name: `${TAG2}siteD`, client_id: clientBId2, organization_id: orgBId2 }).select('id').single()).data!.id as string
    siteEId2 = (await db.from('sites').insert({ name: `${TAG2}siteE`, client_id: clientBId2, organization_id: orgBId2 }).select('id').single()).data!.id as string

    // TEAM_A — ORG_A, active. Appartenance courante légitime pour userCasA (côté ORG_A).
    teamAId2 = (await db.from('teams').insert({ name: `${TAG2}teamA`.slice(0, 50), organization_id: orgAId2 }).select('id').single()).data!.id as string
    // TEAM_B — ORG_B, active. userCasA la rejoint puis son appartenance ORG_B
    // est révoquée (CAS A) — nom gardé "Stale" car l'intention métier du cas
    // est une trace de présence devenue obsolète, même si le trigger 237
    // ferme déjà `left_at` automatiquement à la révocation (cf. commentaire
    // détaillé plus bas, au moment de la révocation).
    teamBStaleId2 = (await db.from('teams').insert({ name: `${TAG2}teamBStale`.slice(0, 50), organization_id: orgBId2 }).select('id').single()).data!.id as string
    // TEAM_C — ORG_B, ARCHIVÉE (active=false). userCasB y a `left_at IS NULL`
    // mais l'équipe elle-même est morte (CAS B).
    teamCArchivedId2 = (await db.from('teams').insert({ name: `${TAG2}teamCArchived`.slice(0, 50), organization_id: orgBId2, active: false }).select('id').single()).data!.id as string
    // TEAM_D — ORG_B, active. userCasC y est membre ACTIF, avec un rôle
    // chef_equipe (pas manager) dans ORG_B (CAS C).
    teamDId2 = (await db.from('teams').insert({ name: `${TAG2}teamD`.slice(0, 50), organization_id: orgBId2 }).select('id').single()).data!.id as string

    const mkMission = async (siteId: string, orgId: string, teamId: string | null, label: string) => {
      const row: Record<string, unknown> = { site_id: siteId, name: `${TAG2} ${label}`, organization_id: orgId }
      if (teamId) row.assigned_team_id = teamId
      const id = (await db.from('missions').insert(row).select('id').single()).data!.id as string
      missionIds.push(id)
      return id
    }
    await mkMission(siteAId2, orgAId2, teamAId2, 'mission A')
    await mkMission(siteBId2, orgBId2, teamBStaleId2, 'mission B (stale team)')
    await mkMission(siteCId2, orgBId2, teamCArchivedId2, 'mission C (archived team)')
    await mkMission(siteDId2, orgBId2, teamDId2, 'mission D')
    await mkMission(siteEId2, orgBId2, null, 'mission E (sans équipe assignée)')

    const mkMembership = async (userId: string, orgId: string, role: 'admin' | 'manager' | 'chef_equipe') => {
      const id = (await db.from('organization_memberships').insert({ user_id: userId, organization_id: orgId, role, status: 'active' }).select('id').single()).data!.id as string
      membershipIds.push(id)
      return id
    }

    // CAS A : userCasA — appartenance ACTIVE et durable à ORG_A, et une
    // appartenance ORG_B REVOQUÉE après avoir rejoint TEAM_B (cycle de vie
    // réel de Manu Kotra : rejoindre, puis quitter l'organisation).
    //
    // Note structurelle : depuis la migration 237, le trigger
    // `close_team_members_when_org_membership_inactive` ferme automatiquement
    // (met `left_at`) tout `team_members` actif dès que l'appartenance
    // correspondante quitte le statut actif (update OU delete) — cf.
    // tests/lib/team-members-org-integrity.test.ts, qui prouve cet
    // invariant. La combinaison littérale « left_at NULL + aucune
    // appartenance active » n'est donc plus constructible par la voie
    // applicative normale : même une INSERT directe sans appartenance active
    // est rejetée par un second trigger, AVANT même addMemberToTeam. Ce test
    // rejoue donc le cycle de vie réel plutôt que l'état brut, et prouve que
    // `listAccessibleSiteIdsForUser` perd l'accès à SITE_B dès que
    // l'appartenance ORG_B disparaît — défense en profondeur avec le même
    // résultat que le trigger, utile pour toute ligne héritée d'avant la
    // migration 237 où `left_at` serait resté NULL par construction ancienne.
    await mkMembership(userCasAId, orgAId2, 'chef_equipe')
    await addMemberToTeam(teamAId2, userCasAId)

    const casATempOrgBMembershipId = (
      await db
        .from('organization_memberships')
        .insert({ user_id: userCasAId, organization_id: orgBId2, role: 'chef_equipe', status: 'active' })
        .select('id')
        .single()
    ).data!.id as string
    await addMemberToTeam(teamBStaleId2, userCasAId)
    // Révocation : l'appartenance ORG_B disparaît.
    await db.from('organization_memberships').delete().eq('id', casATempOrgBMembershipId)

    // CAS B : userCasB — appartenance ACTIVE à ORG_B, membre COURANT de
    // TEAM_C — mais TEAM_C est archivée (active=false).
    await mkMembership(userCasBId, orgBId2, 'chef_equipe')
    await addMemberToTeam(teamCArchivedId2, userCasBId)

    // CAS C : userCasC — manager dans ORG_A (couverture totale ORG_A, mais ici
    // ORG_A n'a que SITE_A qu'on ne veut pas tester ici) + chef_equipe dans
    // ORG_B, membre de TEAM_D (→ SITE_D seulement, jamais SITE_E malgré même
    // organisation).
    await mkMembership(userCasCId, orgAId2, 'manager')
    await mkMembership(userCasCId, orgBId2, 'chef_equipe')
    await addMemberToTeam(teamDId2, userCasCId)

    // Legacy : userLegacyOrgId — AUCUNE appartenance active nulle part. Son
    // `users.organization_id` (colonne legacy) pointe vers ORG_B — ne doit
    // jamais donner accès à ORG_B, la fonction ne lit même plus ce champ.
    await db.from('users').update({ organization_id: orgBId2 }).eq('id', userLegacyOrgId)
  })

  afterAll(async () => {
    const db = createAdminClient()
    if (missionIds.length > 0) await db.from('missions').delete().in('id', missionIds)
    for (const [teamId, uId] of [
      [teamAId2, userCasAId],
      [teamBStaleId2, userCasAId],
      [teamCArchivedId2, userCasBId],
      [teamDId2, userCasCId],
    ] as const) {
      await db.from('team_members').delete().eq('team_id', teamId).eq('user_id', uId)
    }
    await db.from('teams').delete().in('id', [teamAId2, teamBStaleId2, teamCArchivedId2, teamDId2])
    if (membershipIds.length > 0) await db.from('organization_memberships').delete().in('id', membershipIds)
    await db.from('sites').delete().in('id', [siteAId2, siteBId2, siteCId2, siteDId2, siteEId2])
    await db.from('clients').delete().in('id', [clientAId2, clientBId2])
    await db.from('organizations').delete().in('id', [orgAId2, orgBId2])
    for (const uId of [userCasAId, userCasBId, userCasCId, userLegacyOrgId]) {
      if (uId) await db.auth.admin.deleteUser(uId)
    }
  })

  it('CAS A — après révocation de l\'appartenance ORG_B (ex-membre de TEAM_B) : SITE_B inaccessible, SITE_A (ORG_A) conservé', async () => {
    const siteIds = await listAccessibleSiteIdsForUser({ id: userCasAId })
    expect(siteIds).toEqual([siteAId2])
  })

  it('CAS B — équipe archivée (active=false) malgré team_members courant : aucun accès via cette équipe', async () => {
    const siteIds = await listAccessibleSiteIdsForUser({ id: userCasBId })
    expect(siteIds).toEqual([])
  })

  it('CAS C — rôles multi-org : manager ORG_A → tous ses sites ; chef_equipe ORG_B → SEULEMENT les sites de ses équipes, jamais tous les sites ORG_B', async () => {
    const siteIds = await listAccessibleSiteIdsForUser({ id: userCasCId })
    expect(new Set(siteIds)).toEqual(new Set([siteAId2, siteDId2]))
    expect(siteIds).not.toContain(siteBId2)
    expect(siteIds).not.toContain(siteCId2)
    expect(siteIds).not.toContain(siteEId2)
  })

  it('user.organization_id legacy sans appartenance active : aucun accès à cette organisation', async () => {
    const siteIds = await listAccessibleSiteIdsForUser({ id: userLegacyOrgId })
    expect(siteIds).toEqual([])
  })
})
