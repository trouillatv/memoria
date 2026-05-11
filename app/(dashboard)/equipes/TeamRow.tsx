// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Ligne d'équipe (server component) : nom + composition (liste de noms) +
// actions (Éditer / Archiver).
//
// Doctrine V2 : composition affichée comme suite de noms simples, JAMAIS
// avec des métriques individuelles ou collectives.

import { listMembersOfTeam, type TeamWithMemberCount } from '@/lib/db/teams'
import { TeamBadge } from '@/components/ui/team-badge'
import { EditTeamMembersDialog, type MemberLite } from './EditTeamMembersDialog'
import { ArchiveTeamButton } from './ArchiveTeamButton'

interface Props {
  team: TeamWithMemberCount
  availableUsers: MemberLite[]
}

function displayName(fullName: string | null, email: string): string {
  const t = (fullName ?? '').trim()
  if (t.length > 0) return t
  // Fallback : partie locale de l'email (avant le @), capitalisée.
  const local = email.split('@')[0] ?? email
  return local
}

export async function TeamRow({ team, availableUsers }: Props) {
  const memberships = await listMembersOfTeam(team.id)
  const members: MemberLite[] = memberships.map((m) => ({
    id: m.user.id,
    name: displayName(m.user.full_name, m.user.email),
    email: m.user.email,
  }))

  return (
    <div
      data-slot="team-row"
      data-team-id={team.id}
      className="flex flex-col gap-3 border-t px-4 py-4 first:border-t-0 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <TeamBadge name={team.name} color={team.color} size="md" />
          <span className="text-sm text-muted-foreground">
            · {team.memberCount} personne{team.memberCount > 1 ? 's' : ''}
          </span>
        </div>
        <div className="mt-2 text-sm text-foreground/90">
          {members.length === 0 ? (
            <span className="italic text-muted-foreground">
              Aucun membre — cliquez sur Éditer pour en ajouter.
            </span>
          ) : (
            members.map((m, i) => (
              <span key={m.id}>
                {i > 0 && <span className="mx-2 text-muted-foreground">·</span>}
                <span>{m.name}</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <EditTeamMembersDialog
          teamId={team.id}
          teamName={team.name}
          members={members}
          availableUsers={availableUsers}
        />
        <ArchiveTeamButton teamId={team.id} teamName={team.name} />
      </div>
    </div>
  )
}
