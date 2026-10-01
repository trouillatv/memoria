// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
// /EQUIPES V2 (Batch D) — page unique : composition + vue détail intégrée
// (`?team=<id>` / `?person=<id>`). Plus de route /equipes/[id] comme
// expérience principale — voir EquipesDetailView.tsx et loadTeamDrawerData.ts.
//
// SEUL endroit en supervision où on voit des noms d'agents. Doctrine V2 :
//   - Wording « Équipe Alpha », jamais « L'équipe de Mehdi »
//   - Zéro métrique individuelle (pas d'historique, pas de stats)
//   - Zéro métrique d'équipe (pas de charge, pas de couverture)
//   - La vue détail ÉQUIPE ajoute des compteurs CUMULÉS descriptifs
//     (cf. doctrine dans TeamDetailBody.tsx) — jamais un classement.

import { redirect } from 'next/navigation'
import { Users, AlertCircle } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getOrgsForSelector } from '@/components/ui/org-selector'
import { createAdminClient } from '@/lib/supabase/admin'
import { listTeamsWithMemberCount, listOrphanUsers, listOrphanContacts } from '@/lib/db/teams'
import { getTeamsGlobalPulse, parsePulsePeriod } from '@/lib/db/team-pulse'
import { listTeamsActivitySummary } from '@/lib/db/team-activity-summary'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { AddPersonButton } from './AddPersonButton'
import { CreateTeamButton } from './CreateTeamButton'
import { TeamsTable } from './TeamsTable'
import { TeamsSearchHeader } from './TeamsSearchHeader'
import { OrganisationKpiBlock } from './OrganisationKpiBlock'
import { MemoireTerrainBlock } from './MemoireTerrainBlock'
import { OrphansTable, type OrphanRow } from './OrphansTable'
import { EquipesDetailView } from './EquipesDetailView'
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
    period?: string
    q?: string
    teamFilter?: string
  }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  // Belt + suspenders : le layout (dashboard) redirige déjà chef_equipe vers /m.
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/m')

  const sp = await searchParams
  const personKind = sp.personKind === 'contact' ? 'contact' : 'user'
  const personPeriod = parsePersonPeriod(sp.personPeriod)
  const pulsePeriod = parsePulsePeriod(sp.period)

  // FIX MULTI-ORG (revue ChatGPT/Vincent, cc83c29b) — orgIds doit être résolu
  // AVANT les appels qui en dépendent (listAssignableMembers, loadTeamDrawerData),
  // jamais utilisé en parallèle d'eux dans le même Promise.all.
  const orgIds = await getOrgIdsOfUser()

  // INCIDENT /equipes (2026-09-30) — le pulse est un enrichissement « wow »,
  // jamais une donnée critique : sa défaillance ne doit plus jamais faire
  // tomber toute la page (contrairement aux items CORE ci-dessus — teams,
  // orphelins, personnes assignables, org — qui restent bloquants à dessein).
  // Jamais de faux compteurs à 0 : `null` déclenche un état dégradé explicite
  // dans OrganisationKpiBlock/MemoireTerrainBlock, la vraie requête reste
  // corrigée ci-dessous, pas contournée.
  const [teams, orphans, orphanContacts, availableUsers, orgs, pulse] = await Promise.all([
    listTeamsWithMemberCount(),
    listOrphanUsers(),
    listOrphanContacts(),
    listAssignableMembers(orgIds),
    getOrgsForSelector(),
    getTeamsGlobalPulse(Number(pulsePeriod)).catch((error: unknown) => {
      console.error('[equipes] pulse indisponible', error)
      return null
    }),
  ])

  const teamDrawerData = sp.team ? await loadTeamDrawerData(sp.team, orgIds) : null

  const teamsWithoutReferentCount = teams.filter((t) => !t.referent).length

  // Recherche + filtre "Mes équipes" pilotés par l'URL (?q=, ?teamFilter=),
  // jamais par du CSS/DOM côté client — TeamsTable reste un Server Component,
  // page.tsx filtre `teams` avant de le lui passer. Les compteurs KPI
  // (OrganisationKpiBlock) restent calculés sur la population complète.
  const searchQuery = (sp.q ?? '').trim().toLowerCase()
  const teamFilter: 'all' | 'without-referent' = sp.teamFilter === 'without-referent' ? 'without-referent' : 'all'
  const filteredTeams = teams.filter((t) => {
    if (searchQuery && !t.name.toLowerCase().includes(searchQuery)) return false
    if (teamFilter === 'without-referent' && t.referent) return false
    return true
  })

  // Bandeau « sans équipe » : les deux populations disjointes (comptes
  // applicatifs + contacts terrain) sont affichées côte à côte, jamais
  // fusionnées en base — seule la colonne Type du tableau les distingue
  // (cf. OrphansTable.tsx pour le routage par nature vers l'action adaptée).
  const orphanRows: OrphanRow[] = [
    ...orphans.map((u) => ({
      id: u.id,
      kind: 'user' as const,
      name: displayName(u.full_name, u.email),
      job: u.role === 'manager' ? 'Manager' : u.role === 'chef_equipe' ? 'Chef d’équipe' : u.role,
      companyName: null,
    })),
    ...orphanContacts.map((c) => ({
      id: c.id,
      kind: 'contact' as const,
      name: c.fullName,
      job: c.job,
      companyName: c.companyName,
    })),
  ]

  // Table dense : colonnes Activité/Sites/Photos/Roulements batchées en un
  // seul jeu de requêtes, limité aux équipes réellement affichées après
  // filtre (Task #85 + correctif recherche, jamais une requête par équipe).
  // Fenêtre fixe 30j, indépendante du sélecteur de période du bloc Mémoire
  // terrain ci-dessus (compteur de colonne descriptif, pas un filtre
  // utilisateur).
  const activitySummaries = await listTeamsActivitySummary(filteredTeams.map((t) => t.id))

  const personDrawerData = sp.person
    ? await loadPersonDrawerData(sp.person, personKind, orgIds, personPeriod)
    : null

  // Priorité : une personne active prime sur une équipe active (cliquer une
  // personne depuis l'onglet Membres d'une équipe doit bien afficher la
  // personne). Le lien de retour reconstruit le contexte équipe d'origine
  // si `?team=` est encore présent dans l'URL.
  const active: 'team' | 'person' | null =
    sp.person && personDrawerData ? 'person' : sp.team && teamDrawerData ? 'team' : null
  const backHref =
    active === 'person' && sp.team && teamDrawerData ? `/equipes?team=${sp.team}` : '/equipes'
  const backLabel =
    active === 'person' && sp.team && teamDrawerData ? teamDrawerData.overview.name : 'Toutes les équipes'

  if (active) {
    return (
      <EquipesDetailView
        active={active}
        team={teamDrawerData}
        person={personDrawerData}
        availableUsers={availableUsers}
        backHref={backHref}
        backLabel={backLabel}
      />
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Users className="h-6 w-6 text-brand-600" />
            Équipes
          </h1>
          <p className="text-sm text-muted-foreground">
            Organisation des équipes et mémoire opérationnelle terrain.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AddPersonButton teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
          <CreateTeamButton orgs={orgs} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrganisationKpiBlock pulse={pulse} teamsWithoutReferentCount={teamsWithoutReferentCount} />
        <MemoireTerrainBlock pulse={pulse} period={pulsePeriod} />
      </div>

      <div className="space-y-2">
        <TeamsSearchHeader count={filteredTeams.length} initialQuery={sp.q ?? ''} initialFilter={teamFilter} />
        <Card>
          <CardContent className="p-0">
            {teams.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Aucune équipe pour l’instant"
                description="Créez une équipe pour organiser la couverture des missions. Une équipe regroupe des chefs d’équipe sans hiérarchie ni métrique."
                variant="compact"
              />
            ) : filteredTeams.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Aucune équipe ne correspond"
                description="Essayez un autre terme de recherche ou retirez le filtre « Sans référent »."
                variant="compact"
              />
            ) : (
              <TeamsTable teams={filteredTeams} availableUsers={availableUsers} activitySummaries={activitySummaries} />
            )}
          </CardContent>
        </Card>
      </div>

      {orphanRows.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <AlertCircle className="h-4 w-4" />
              {orphanRows.length} {orphanRows.length > 1 ? 'personnes' : 'personne'} pas dans une équipe active
            </div>
            <p className="text-xs text-amber-800/80">
              Ces personnes ne sont rattachées à aucune équipe active. Rattachez-les en une fois,
              ou via « Éditer » sur une équipe existante.
            </p>
            <OrphansTable orphans={orphanRows} teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
