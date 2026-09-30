import { describe, it, expect } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

// INCIDENT /equipes (2026-09-30) — régression réelle PostgREST, PAS un mock.
//
// team_members a DEUX FK vers teams (team_members_team_id_fkey, et
// team_members_team_organization_fk ajoutée par la migration 237). Un embed
// `teams!inner(...)` SANS hint de colonne est donc ambigu pour PostgREST
// (PGRST201, HTTP 300) — c'est ce qui faisait planter TOUTE la page /equipes
// à chaque chargement (listOrphanUsers() + loadPersonDrawerData()). Un mock
// Vitest classique ne peut PAS détecter ce genre d'erreur : il accepte
// n'importe quelle chaîne `.select(...)` sans connaître le schéma réel.
//
// Ce test interroge la VRAIE base (aucune écriture) pour verrouiller :
//   1) le pattern fautif reproduit bien PGRST201 (documente l'incident) ;
//   2) le pattern corrigé (`teams!team_id!inner(...)`) est accepté.

describe('PostgREST — embed team_members -> teams (incident /equipes 2026-09-30)', () => {
  it('sans hint de colonne (teams!inner) → PGRST201, ambiguïté FK', async () => {
    const admin = createAdminClient()
    const { error, status } = await admin
      .from('team_members')
      .select('user_id, team:teams!inner(active, deleted_at, organization_id)')
      .is('left_at', null)
      .limit(1)

    expect(status).toBe(300)
    expect(error?.code).toBe('PGRST201')
  })

  it('avec hint de colonne (teams!team_id!inner) → accepté, pattern corrigé de listOrphanUsers', async () => {
    const admin = createAdminClient()
    const { error } = await admin
      .from('team_members')
      .select('user_id, team:teams!team_id!inner(active, deleted_at, organization_id)')
      .is('left_at', null)
      .limit(1)

    expect(error).toBeNull()
  })

  it('avec hint de colonne (teams!team_id!inner) → accepté, pattern corrigé de loadPersonDrawerData', async () => {
    const admin = createAdminClient()
    const { error } = await admin
      .from('team_members')
      .select('team:teams!team_id!inner(id, name, deleted_at, organization_id)')
      .is('left_at', null)
      .limit(1)

    expect(error).toBeNull()
  })
})
