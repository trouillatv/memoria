// /EQUIPES V2 (Lot visuel 2026-10-01) — table dense remplaçant TeamRow.
//
// Doctrine V2 inchangée (cf. TeamRow.tsx, remplacé par ce fichier) :
//   - Composition affichée comme des compteurs descriptifs, jamais une
//     métrique individuelle ou collective.
//   - Les colonnes Activité/Sites/Photos/Roulements viennent du résumé
//     BATCHÉ (lib/db/team-activity-summary.ts, Task #85) — un seul jeu de
//     requêtes pour toutes les équipes, jamais une par équipe.
//   - listMembersOfTeam / listFieldMembersOfTeam / getTeamDependencies
//     restent par équipe (déjà le cas dans TeamRow) : nécessaires aux
//     garde-fous d'archivage (ArchiveTeamButton) et au sélecteur de référent
//     (TeamReferentEditor), pas au périmètre de la Task #85.
//   - Le détail nominatif complet (liste des membres) vit désormais dans le
//     drawer fiche équipe (TeamDrawerBody, onglet Membres) — la table reste
//     un compteur pour permettre le scan, pas une liste de noms.

import Link from 'next/link'
import { ClipboardList, MapPin, Camera, Repeat2 } from 'lucide-react'
import { listMembersOfTeam, getTeamDependencies, type TeamWithMemberCount } from '@/lib/db/teams'
import { listFieldMembersOfTeam } from '@/lib/db/team-field-members'
import type { TeamActivitySummary } from '@/lib/db/team-activity-summary'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { TeamBadge } from '@/components/ui/team-badge'
import { TeamReferentEditor } from './TeamReferentEditor'
import { EditTeamAppearanceButton } from './EditTeamAppearanceButton'
import { EditTeamMembersDialog, type MemberLite } from './EditTeamMembersDialog'
import { ArchiveTeamButton } from './ArchiveTeamButton'

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

function MetricCell({ icon: Icon, value }: { icon: React.ElementType; value: number }) {
  return (
    <TableCell className="text-right tabular-nums">
      {value > 0 ? (
        <span className="inline-flex items-center justify-end gap-1 text-foreground">
          {value}
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      ) : (
        <span className="text-muted-foreground/60">—</span>
      )}
    </TableCell>
  )
}

export async function TeamsTable({ teams, availableUsers, activitySummaries }: Props) {
  const rows = await Promise.all(
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
      return { team, members, fieldMembers, deps, referent }
    }),
  )

  return (
    <>
      {/* Desktop/tablette — table dense (cf. doctrine ci-dessus) */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
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
            {rows.map(({ team, members, fieldMembers, deps, referent }) => {
              const summary = activitySummaries.get(team.id)
              const totalPersons = team.memberCount + fieldMembers.length
              return (
                <TableRow key={team.id} data-slot="team-row" data-team-id={team.id}>
                  <TableCell>
                    <Link
                      href={`/equipes?team=${team.id}`}
                      className="inline-block hover:opacity-80 transition-opacity"
                      title="Ouvrir la fiche équipe"
                      data-testid={`open-team-profile-${team.id}`}
                    >
                      <TeamBadge name={team.name} color={team.color} icon={team.icon} size="md" />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">
                      {totalPersons} personne{totalPersons > 1 ? 's' : ''}
                    </div>
                    {fieldMembers.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {team.memberCount} accès · {fieldMembers.length} terrain
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <TeamReferentEditor
                      teamId={team.id}
                      teamName={team.name}
                      current={referent}
                      members={members}
                    />
                  </TableCell>
                  <MetricCell icon={ClipboardList} value={summary?.realInterventionsCount ?? 0} />
                  <MetricCell icon={MapPin} value={summary?.sitesReallyCoveredCount ?? 0} />
                  <MetricCell icon={Camera} value={summary?.terrainPhotosCount ?? 0} />
                  <MetricCell icon={Repeat2} value={summary?.activeRotationCount ?? 0} />
                  <TableCell>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <EditTeamAppearanceButton
                        teamId={team.id}
                        initialName={team.name}
                        initialColor={team.color}
                        initialIcon={team.icon}
                      />
                      <EditTeamMembersDialog
                        teamId={team.id}
                        teamName={team.name}
                        members={members}
                        availableUsers={availableUsers}
                      />
                      <ArchiveTeamButton
                        teamId={team.id}
                        teamName={team.name}
                        dependencies={{
                          missions: deps.missions,
                          futureInterventions: deps.futureInterventions,
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile — cartes compactes, mêmes données que la table (jamais une
          table à défilement horizontal sur petit écran). */}
      <div className="divide-y md:hidden" data-testid="teams-list-mobile">
        {rows.map(({ team, members, fieldMembers, deps, referent }) => {
          const summary = activitySummaries.get(team.id)
          const totalPersons = team.memberCount + fieldMembers.length
          return (
            <div key={team.id} className="space-y-2.5 p-3" data-slot="team-card" data-team-id={team.id}>
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/equipes?team=${team.id}`}
                  className="inline-block hover:opacity-80 transition-opacity"
                  title="Ouvrir la fiche équipe"
                  data-testid={`open-team-profile-mobile-${team.id}`}
                >
                  <TeamBadge name={team.name} color={team.color} icon={team.icon} size="md" />
                </Link>
                <div className="flex shrink-0 items-center gap-0.5">
                  <EditTeamAppearanceButton
                    teamId={team.id}
                    initialName={team.name}
                    initialColor={team.color}
                    initialIcon={team.icon}
                  />
                  <EditTeamMembersDialog
                    teamId={team.id}
                    teamName={team.name}
                    members={members}
                    availableUsers={availableUsers}
                  />
                  <ArchiveTeamButton
                    teamId={team.id}
                    teamName={team.name}
                    dependencies={{
                      missions: deps.missions,
                      futureInterventions: deps.futureInterventions,
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {totalPersons} personne{totalPersons > 1 ? 's' : ''}
                  {fieldMembers.length > 0 && ` (${team.memberCount} accès · ${fieldMembers.length} terrain)`}
                </span>
              </div>

              <TeamReferentEditor
                teamId={team.id}
                teamName={team.name}
                current={referent}
                members={members}
              />

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ClipboardList className="h-3.5 w-3.5" />
                  {summary?.realInterventionsCount ?? 0}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {summary?.sitesReallyCoveredCount ?? 0}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Camera className="h-3.5 w-3.5" />
                  {summary?.terrainPhotosCount ?? 0}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Repeat2 className="h-3.5 w-3.5" />
                  {summary?.activeRotationCount ?? 0}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
