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
//   - Colonne Membres (2026-10-01, FIX_REQUIRED Vincent) : noms cliquables
//     vers la fiche Personne, "+ N autres" renvoie vers l'onglet Membres de
//     la fiche équipe (`?team=<id>&tab=membres`) pour le détail complet.

import Link from 'next/link'
import { ClipboardList, MapPin, Camera, Repeat2 } from 'lucide-react'
import { listMembersOfTeam, getTeamDependencies, type TeamWithMemberCount } from '@/lib/db/teams'
import { listFieldMembersOfTeam, type FieldMember } from '@/lib/db/team-field-members'
import type { TeamActivitySummary } from '@/lib/db/team-activity-summary'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { TeamBadge } from '@/components/ui/team-badge'
import { TeamReferentEditor } from './TeamReferentEditor'
import { EditTeamMembersDialog, type MemberLite } from './EditTeamMembersDialog'
import { TeamRowActionsMenu } from './TeamRowActionsMenu'

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

function metricText(value: number): string {
  return value > 0 ? String(value) : '—'
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface PersonLite {
  id: string
  kind: 'user' | 'contact'
  name: string
}

const MAX_VISIBLE_MEMBERS = 2

function PersonChip({ person, teamId }: { person: PersonLite; teamId: string }) {
  const href = `/equipes?person=${person.id}&personKind=${person.kind}&team=${teamId}`
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 hover:underline underline-offset-2"
      title={`Ouvrir la fiche de ${person.name}`}
    >
      <Avatar size="sm">
        <AvatarFallback>{initials(person.name)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-sm text-foreground">{person.name}</span>
    </Link>
  )
}

function MembersCell({ people, teamId }: { people: PersonLite[]; teamId: string }) {
  const visible = people.slice(0, MAX_VISIBLE_MEMBERS)
  const overflow = people.length - visible.length
  return (
    <div className="space-y-1">
      {visible.map((p) => (
        <div key={`${p.kind}:${p.id}`}>
          <PersonChip person={p} teamId={teamId} />
        </div>
      ))}
      {overflow > 0 && (
        <Link
          href={`/equipes?team=${teamId}&tab=membres`}
          className="block text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
        >
          + {overflow} autre{overflow > 1 ? 's' : ''}
        </Link>
      )}
    </div>
  )
}

function AddMemberLink() {
  return (
    <button
      type="button"
      className="text-xs font-medium text-brand-700 underline underline-offset-2 hover:no-underline dark:text-brand-300"
    >
      + Ajouter
    </button>
  )
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
      // Deux populations disjointes (accès appli / terrain sans compte), jamais
      // fusionnées en base — ici seulement assemblées pour l'affichage.
      const people: PersonLite[] = [
        ...members.map((m) => ({ id: m.id, kind: 'user' as const, name: m.name })),
        ...(fieldMembers as FieldMember[]).map((f) => ({
          id: f.contactId,
          kind: 'contact' as const,
          name: f.fullName,
        })),
      ]
      return { team, members, fieldMembers, deps, referent, people }
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
            {rows.map(({ team, members, fieldMembers, deps, referent, people }) => {
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
                    {totalPersons === 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Aucun membre</span>
                        <EditTeamMembersDialog
                          teamId={team.id}
                          teamName={team.name}
                          members={members}
                          availableUsers={availableUsers}
                          trigger={<AddMemberLink />}
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <MembersCell people={people} teamId={team.id} />
                        <div className="text-xs text-muted-foreground">
                          {totalPersons} personne{totalPersons > 1 ? 's' : ''}
                          {fieldMembers.length > 0 && ` · ${team.memberCount} accès · ${fieldMembers.length} terrain`}
                        </div>
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
                    <TeamRowActionsMenu
                      teamId={team.id}
                      teamName={team.name}
                      initialColor={team.color}
                      initialIcon={team.icon}
                      members={members}
                      availableUsers={availableUsers}
                      dependencies={{
                        missions: deps.missions,
                        futureInterventions: deps.futureInterventions,
                      }}
                    />
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
        {rows.map(({ team, members, fieldMembers, deps, referent, people }) => {
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
                <TeamRowActionsMenu
                  teamId={team.id}
                  teamName={team.name}
                  initialColor={team.color}
                  initialIcon={team.icon}
                  members={members}
                  availableUsers={availableUsers}
                  dependencies={{
                    missions: deps.missions,
                    futureInterventions: deps.futureInterventions,
                  }}
                />
              </div>

              <div className="text-xs text-muted-foreground">
                {totalPersons === 0 ? (
                  <span className="flex items-center gap-2">
                    Aucun membre
                    <EditTeamMembersDialog
                      teamId={team.id}
                      teamName={team.name}
                      members={members}
                      availableUsers={availableUsers}
                      trigger={<AddMemberLink />}
                    />
                  </span>
                ) : (
                  <div className="space-y-1">
                    <MembersCell people={people} teamId={team.id} />
                    <span>
                      {totalPersons} personne{totalPersons > 1 ? 's' : ''}
                      {fieldMembers.length > 0 && ` (${team.memberCount} accès · ${fieldMembers.length} terrain)`}
                    </span>
                  </div>
                )}
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
                  {metricText(summary?.realInterventionsCount ?? 0)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {metricText(summary?.sitesReallyCoveredCount ?? 0)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Camera className="h-3.5 w-3.5" />
                  {metricText(summary?.terrainPhotosCount ?? 0)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Repeat2 className="h-3.5 w-3.5" />
                  {metricText(summary?.activeRotationCount ?? 0)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
