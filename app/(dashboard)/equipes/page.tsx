// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Page Équipes : composition isolée.
//
// SEUL endroit en supervision où on voit des noms d'agents. Doctrine V2 :
//   - Wording « Équipe Alpha », jamais « L'équipe de Mehdi »
//   - Zéro métrique individuelle (pas d'historique, pas de stats)
//   - Zéro métrique d'équipe (pas de charge, pas de couverture)
//   - Seules infos affichées : nom, composition, couleur sobre

import { redirect } from 'next/navigation'
import { Users, AlertCircle } from 'lucide-react'
import { getCurrentUserWithProfile, getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { listTeamsWithMemberCount, listOrphanUsers } from '@/lib/db/teams'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { CreateTeamButton } from './CreateTeamButton'
import { TeamRow } from './TeamRow'
import type { MemberLite } from './EditTeamMembersDialog'

export const dynamic = 'force-dynamic'

function displayName(fullName: string | null, email: string): string {
  const t = (fullName ?? '').trim()
  if (t.length > 0) return t
  return email.split('@')[0] ?? email
}

async function listAssignableMembers(): Promise<MemberLite[]> {
  const supabase = createAdminClient()
  // Scope org OBLIGATOIRE : createAdminClient() bypasse la RLS, donc sans ce
  // filtre le sélecteur remonte les personnes de TOUTES les organisations
  // (cf. le reste de lib/db/teams.ts qui scope déjà via getOrgId()).
  const orgId = await getOrgId()
  const [{ data: users, error: uErr }, { data: memberships, error: mErr }] =
    await Promise.all([
      (() => {
        // Appartenance indépendante du rôle : toute personne pouvant intervenir
        // sur un chantier (tout le monde sauf le compte système admin) peut être
        // membre d'une équipe — le planning affecte des équipes, pas des rôles.
        let q = supabase
          .from('users')
          .select('id, full_name, email, role')
          .neq('role', 'admin')
          .is('deleted_at', null)
          .order('full_name', { ascending: true })
        if (orgId) q = q.eq('organization_id', orgId)
        return q
      })(),
      // Memberships actives + nom de l'équipe associée — pour signaler dans
      // le sélecteur "déjà dans Équipe X" et éviter les doublons cross-équipes.
      supabase
        .from('team_members')
        .select('user_id, team:teams(id, name, deleted_at)')
        .is('left_at', null),
    ])
  if (uErr) throw uErr
  if (mErr) throw mErr

  type TeamLite = { id: string; name: string; deleted_at: string | null }
  const teamsByUser = new Map<string, string[]>()
  for (const m of (memberships ?? []) as Array<{
    user_id: string
    team: TeamLite | TeamLite[] | null
  }>) {
    const t = Array.isArray(m.team) ? m.team[0] ?? null : m.team
    if (!t || t.deleted_at) continue
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

export default async function EquipesPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  // Belt + suspenders : le layout (dashboard) redirige déjà chef_equipe vers /m.
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const [teams, orphans, availableUsers] = await Promise.all([
    listTeamsWithMemberCount(),
    listOrphanUsers(),
    listAssignableMembers(),
  ])

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
        <CreateTeamButton />
      </header>

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
              {orphans.length} {orphans.length > 1 ? 'personnes' : 'personne'} pas dans une équipe
            </div>
            <p className="text-xs text-amber-800/80">
              Ces personnes ne sont rattachées à aucune équipe active.
              Ajoutez-les via « Éditer » sur une équipe existante.
            </p>
            <div className="text-sm text-amber-900" data-testid="orphans-list">
              {orphans.map((u, i) => (
                <span key={u.id}>
                  {i > 0 && <span className="mx-2 text-amber-700/60">·</span>}
                  <span>{displayName(u.full_name, u.email)}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
