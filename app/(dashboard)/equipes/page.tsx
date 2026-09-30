// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
// /EQUIPES V2 (Batch D) — page unique : composition + drawer intégré
// (WOW ÉQUIPE, `?team=<id>`). Plus de route /equipes/[id] comme expérience
// principale — voir EquipesDetailSheet.tsx et loadTeamDrawerData.ts.
//
// SEUL endroit en supervision où on voit des noms d'agents. Doctrine V2 :
//   - Wording « Équipe Alpha », jamais « L'équipe de Mehdi »
//   - Zéro métrique individuelle (pas d'historique, pas de stats)
//   - Zéro métrique d'équipe (pas de charge, pas de couverture)
//   - Le drawer WOW ÉQUIPE ajoute des compteurs CUMULÉS descriptifs
//     (cf. doctrine dans TeamDrawerBody.tsx) — jamais un classement.

import { redirect } from 'next/navigation'
import { Users, AlertCircle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrgsForSelector } from '@/components/ui/org-selector'
import { createAdminClient } from '@/lib/supabase/admin'
import { listTeamsWithMemberCount, listOrphanUsers } from '@/lib/db/teams'
import { getTeamsGlobalPulse } from '@/lib/db/team-pulse'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { CreateTeamButton } from './CreateTeamButton'
import { TeamRow } from './TeamRow'
import { TeamsGlobalPulseRow } from './TeamsGlobalPulseRow'
import { OrphansBulkAssign } from './OrphansBulkAssign'
import { EquipesDetailSheet } from './EquipesDetailSheet'
import { loadTeamDrawerData } from './loadTeamDrawerData'
import { loadPersonDrawerData, parsePersonPeriod } from './loadPersonDrawerData'
import type { MemberLite } from './EditTeamMembersDialog'

export const dynamic = 'force-dynamic'

function displayName(fullName: string | null, email: string): string {
  const t = (fullName ?? '').trim()
  if (t.length > 0) return t
  return email.split('@')[0] ?? email
}

// Exporté uniquement pour couverture de test (FIX MULTI-ORG, cc83c29b) — la
// fuite de nom d'équipe cross-org corrigée ici n'a pas d'autre point d'entrée
// unitaire ; page.tsx reste la seule route qui l'appelle en production.
export async function listAssignableMembers(orgIds: string[]): Promise<MemberLite[]> {
  const supabase = createAdminClient()
  // P1 isolation : FAIL-CLOSED — pas d'organisation → sélecteur vide, jamais
  // les personnes d'un autre tenant.
  if (orgIds.length === 0) return []

  // FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — la population doit venir
  // des appartenances ACTIVES (organization_memberships), jamais de
  // `users.organization_id` : cette colonne n'est qu'une organisation par
  // défaut/legacy dès qu'un compte a plusieurs appartenances (cf.
  // lib/auth/memberships.ts). Un manager multi-org doit voir toute personne
  // active dans SES organisations, quel que soit leur `organization_id` par
  // défaut.
  const { data: activeMemberships, error: amErr } = await supabase
    .from('organization_memberships')
    .select('user_id')
    .eq('status', 'active')
    .in('organization_id', orgIds)
  if (amErr) throw amErr
  const candidateUserIds = Array.from(new Set((activeMemberships ?? []).map((m) => m.user_id)))
  if (candidateUserIds.length === 0) return []

  const [{ data: users, error: uErr }, { data: memberships, error: mErr }] =
    await Promise.all([
      // Appartenance indépendante du rôle : toute personne pouvant intervenir
      // sur un chantier (tout le monde sauf le compte système admin) peut être
      // membre d'une équipe — le planning affecte des équipes, pas des rôles.
      supabase
        .from('users')
        .select('id, full_name, email, role')
        .neq('role', 'admin')
        .is('deleted_at', null)
        .in('id', candidateUserIds)
        .order('full_name', { ascending: true }),
      // Memberships actives + nom de l'équipe associée — pour signaler dans
      // le sélecteur "déjà dans Équipe X" et éviter les doublons cross-équipes.
      // Scope organisation OBLIGATOIRE sur l'équipe elle-même : une personne
      // visible dans org-A peut aussi être membre d'une équipe org-B, dont le
      // nom ne doit jamais fuiter vers un viewer qui n'a pas accès à org-B.
      supabase
        .from('team_members')
        .select('user_id, team:teams!team_id(id, name, deleted_at, organization_id)')
        .is('left_at', null)
        .in('user_id', candidateUserIds),
    ])
  if (uErr) throw uErr
  if (mErr) throw mErr

  type TeamLite = { id: string; name: string; deleted_at: string | null; organization_id: string | null }
  const teamsByUser = new Map<string, string[]>()
  for (const m of (memberships ?? []) as Array<{
    user_id: string
    team: TeamLite | TeamLite[] | null
  }>) {
    const t = Array.isArray(m.team) ? m.team[0] ?? null : m.team
    if (!t || t.deleted_at) continue
    if (!t.organization_id || !orgIds.includes(t.organization_id)) continue
    const arr = teamsByUser.get(m.user_id) ?? []
    arr.push(t.name)
    teamsByUser.set(m.user_id, arr)
  }

  return (users ?? []).map((u) => ({
    id: u.id,
    name: displayName(u.full_name, u.email),
    email: u.email,
    role: (u as { role?: string }).role,
    currentTeamNames: teamsByUser.get(u.id) ?? [],
  }))
}

export default async function EquipesPage({
  searchParams,
}: {
  searchParams: Promise<{
    team?: string
    person?: string
    personKind?: string
    personPeriod?: string
  }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  // Belt + suspenders : le layout (dashboard) redirige déjà chef_equipe vers /m.
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const sp = await searchParams
  const personKind = sp.personKind === 'contact' ? 'contact' : 'user'
  const personPeriod = parsePersonPeriod(sp.personPeriod)

  // FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — orgIds doit être résolu
  // AVANT les appels qui en dépendent (listAssignableMembers, loadTeamDrawerData),
  // jamais utilisé en parallèle d'eux dans le même Promise.all.
  const orgIds = await getOrgIdsOfUser()

  // INCIDENT /equipes (2026-09-30) — le pulse est un enrichissement « wow »,
  // jamais une donnée critique : sa défaillance ne doit plus jamais faire
  // tomber toute la page (contrairement aux items CORE ci-dessus — teams,
  // orphelins, personnes assignables, org — qui restent bloquants à dessein).
  // Jamais de faux compteurs à 0 : `null` déclenche un état dégradé explicite
  // dans TeamsGlobalPulseRow, la vraie requête reste corrigée ci-dessous, pas
  // contournée.
  const [teams, orphans, availableUsers, orgs, teamDrawerData, pulse] = await Promise.all([
    listTeamsWithMemberCount(),
    listOrphanUsers(),
    listAssignableMembers(orgIds),
    getOrgsForSelector(),
    sp.team ? loadTeamDrawerData(sp.team, orgIds) : Promise.resolve(null),
    getTeamsGlobalPulse().catch((error: unknown) => {
      console.error('[equipes] pulse indisponible', error)
      return null
    }),
  ])

  const personDrawerData = sp.person
    ? await loadPersonDrawerData(sp.person, personKind, orgIds, personPeriod)
    : null

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Users className="h-6 w-6 text-brand-600" />
            Équipes
          </h1>
          <p className="text-sm text-muted-foreground">
            Conteneurs logistiques pour la couverture opérationnelle.
            On organise, on ne mesure pas.
          </p>
        </div>
        <CreateTeamButton orgs={orgs} />
      </header>

      <TeamsGlobalPulseRow pulse={pulse} />

      <Card>
        <CardContent className="p-0">
          {teams.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Aucune équipe pour l’instant"
              description="Créez une équipe pour organiser la couverture des missions. Une équipe regroupe des chefs d’équipe sans hiérarchie ni métrique."
              variant="compact"
            />
          ) : (
            <div className="divide-y" data-testid="teams-list">
              {teams.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  availableUsers={availableUsers}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {orphans.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="space-y-2 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <AlertCircle className="h-4 w-4" />
              {orphans.length} {orphans.length > 1 ? 'comptes' : 'compte'} pas dans une équipe active
            </div>
            <p className="text-xs text-amber-800/80">
              Ces comptes ne sont rattachés à aucune équipe active
              {/* FIX C (revue ChatGPT/Vincent, 08e355e2) — « comptes », pas « personnes » : le
                  pulse ci-dessus additionne aussi les contacts terrain (team_field_members),
                  une population distincte que ce bandeau ne liste pas (rattachement en masse
                  réservé aux comptes, cf. OrphansBulkAssign). */}
              . Rattachez-les ci-dessous, ou via « Éditer » sur une équipe existante.
            </p>
            <div className="text-sm text-amber-900" data-testid="orphans-list">
              {orphans.map((u, i) => (
                <span key={u.id}>
                  {i > 0 && <span className="mx-2 text-amber-700/60">·</span>}
                  <span>{displayName(u.full_name, u.email)}</span>
                </span>
              ))}
            </div>
            <OrphansBulkAssign
              orphans={orphans.map((u) => ({ id: u.id, name: displayName(u.full_name, u.email) }))}
              teams={teams.map((t) => ({ id: t.id, name: t.name }))}
            />
          </CardContent>
        </Card>
      )}

      <EquipesDetailSheet team={teamDrawerData} person={personDrawerData} />
    </div>
  )
}
