// /EQUIPES V2 (lot cockpit équipes 2026-10-01) — table avec ligne dépliable.
//
// Doctrine V2 inchangée :
//   - Composition affichée comme des compteurs descriptifs, jamais une
//     métrique individuelle ou collective.
//   - Les colonnes Activité/Sites/Photos/Roulements viennent du résumé
//     BATCHÉ (lib/db/team-activity-summary.ts, Task #85) — un seul jeu de
//     requêtes pour toutes les équipes, jamais une par équipe.
//   - listMembersOfTeam / listFieldMembersOfTeam / getTeamDependencies
//     restent par équipe : nécessaires aux garde-fous d'archivage
//     (ArchiveTeamButton) et au sélecteur de référent (TeamReferentEditor).
//   - Colonne Membres (mandat Vincent 2026-10-01, items 1/2/3/4/8/10) :
//     la composition complète se déplie EN PLACE sous la ligne (TeamRow.tsx),
//     plus de renvoi vers l'onglet Membres de la fiche équipe pour la
//     consulter. Les deux dialogs d'ajout (accès appli / terrain) sont
//     toujours proposés ensemble dans le panneau déplié, y compris pour une
//     équipe vide — corrige le cas où "+ Ajouter" sur une équipe sans membre
//     ne proposait que la population accès appli.

import { listMembersOfTeam, getTeamDependencies, type TeamWithMemberCount } from '@/lib/db/teams'
import { listFieldMembersOfTeam, type FieldMember } from '@/lib/db/team-field-members'
import type { TeamActivitySummary } from '@/lib/db/team-activity-summary'
import { Table, TableHeader, TableBody, TableRow, TableHead } from '@/components/ui/table'
import { type MemberLite } from './EditTeamMembersDialog'
import { TeamRowDesktop, TeamRowMobile, type TeamRowData, type ExpandedPerson } from './TeamRow'

interface Props {
  teams: TeamWithMemberCount[]
  availableUsers: MemberLite[]
  activitySummaries: Map<string, TeamActivitySummary>
}

function displayName(fullName: string | null, email: string): string {
  const t = (fullName ?? '').trim()
  if (t.length > 0) return t
  return email.split('@')[0] ?? email
}

export async function TeamsTable({ teams, availableUsers, activitySummaries }: Props) {
  const rows: TeamRowData[] = await Promise.all(
    teams.map(async (team) => {
      const [memberships, deps, fieldMembers] = await Promise.all([
        listMembersOfTeam(team.id),
        // Ce que l'équipe tient encore — lu AVANT de proposer de l'archiver.
        getTeamDependencies(team.id),
        listFieldMembersOfTeam(team.id).catch(() => []),
      ])
      const members: MemberLite[] = memberships.map((m) => ({
        id: m.user.id,
        name: displayName(m.user.full_name, m.user.email),
        email: m.user.email,
      }))
      const referent = team.referent
        ? { id: team.referent.id, name: displayName(team.referent.full_name, team.referent.email) }
        : null
      // Deux populations disjointes (accès appli / terrain sans compte), jamais
      // fusionnées en base — ici seulement assemblées pour l'affichage.
      const expandedPeople: ExpandedPerson[] = [
        ...memberships.map((m) => ({
          id: m.user.id,
          kind: 'user' as const,
          name: displayName(m.user.full_name, m.user.email),
          joinedAt: m.membership.joined_at,
          isReferent: referent?.id === m.user.id,
        })),
        ...(fieldMembers as FieldMember[]).map((f) => ({
          id: f.contactId,
          kind: 'contact' as const,
          name: f.fullName,
          joinedAt: f.joinedAt,
          isReferent: false,
          job: f.job,
          companyName: f.companyName,
          membershipId: f.membershipId,
        })),
      ]
      return {
        team,
        members,
        expandedPeople,
        deps: { missions: deps.missions, futureInterventions: deps.futureInterventions },
        referent,
        totalPersons: team.memberCount + fieldMembers.length,
        summary: activitySummaries.get(team.id),
      }
    }),
  )

  return (
    <>
      {/* Desktop/tablette — table dense, ligne dépliable (cf. doctrine ci-dessus) */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-px" />
              <TableHead>Équipe</TableHead>
              <TableHead>Membres</TableHead>
              <TableHead>Référent</TableHead>
              <TableHead className="text-right">Activité 30j</TableHead>
              <TableHead className="text-right">Sites</TableHead>
              <TableHead className="text-right">Photos</TableHead>
              <TableHead className="text-right">Roulements</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody data-testid="teams-list">
            {rows.map((row) => (
              <TeamRowDesktop key={row.team.id} row={row} availableUsers={availableUsers} />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile — cartes compactes, jamais une table à défilement horizontal. */}
      <div className="divide-y md:hidden" data-testid="teams-list-mobile">
        {rows.map((row) => (
          <TeamRowMobile key={row.team.id} row={row} availableUsers={availableUsers} />
        ))}
      </div>
    </>
  )
}
