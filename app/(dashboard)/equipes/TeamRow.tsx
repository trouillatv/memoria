// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Ligne d'équipe (server component) : nom + composition (liste de noms) +
// actions (Éditer / Archiver).
//
// Doctrine V2 : composition affichée comme suite de noms simples, JAMAIS
// avec des métriques individuelles ou collectives.

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { listMembersOfTeam, type TeamWithMemberCount } from '@/lib/db/teams'
import { TeamBadge } from '@/components/ui/team-badge'
import { EditTeamMembersDialog, type MemberLite } from './EditTeamMembersDialog'
import { ArchiveTeamButton } from './ArchiveTeamButton'
import { TeamReferentEditor } from './TeamReferentEditor'
import { EditTeamAppearanceButton } from './EditTeamAppearanceButton'

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

  // Référent : doctrine V3 — point de contact stable, jamais une hiérarchie.
  const referent = team.referent
    ? { id: team.referent.id, name: displayName(team.referent.full_name, team.referent.email) }
    : null
  // Pour mettre en exergue le référent dans la liste des membres
  const referentId = referent?.id ?? null

  return (
    <div
      data-slot="team-row"
      data-team-id={team.id}
      className="flex flex-col gap-3 border-t px-4 py-4 first:border-t-0 sm:flex-row sm:items-start sm:justify-between transition-colors duration-200 hover:bg-muted/60"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/equipes/${team.id}`}
            className="hover:opacity-80 transition-opacity"
            title="Ouvrir la fiche équipe"
          >
            <TeamBadge name={team.name} color={team.color} icon={team.icon} size="md" />
          </Link>
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
            members.map((m, i) => {
              const isRef = m.id === referentId
              return (
                <span key={m.id}>
                  {i > 0 && <span className="mx-2 text-muted-foreground">·</span>}
                  <span className={isRef ? 'font-medium text-foreground' : ''}>
                    {m.name}
                  </span>
                  {isRef && (
                    <span
                      className="ml-1 inline-flex items-center text-[9px] uppercase tracking-wider font-medium px-1 py-0.5 rounded bg-brand-50 text-brand-700 dark:bg-brand-600/10 align-middle"
                      title="Référent de l'équipe"
                    >
                      Réf.
                    </span>
                  )}
                </span>
              )
            })
          )}
        </div>
        <div className="mt-2">
          <TeamReferentEditor
            teamId={team.id}
            teamName={team.name}
            current={referent}
            members={members}
            availableUsers={availableUsers}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={`/equipes/${team.id}`}
          data-testid={`open-team-profile-${team.id}`}
          title="Ouvrir la fiche équipe"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="sr-only">Ouvrir la fiche</span>
        </Link>
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
        <ArchiveTeamButton teamId={team.id} teamName={team.name} />
      </div>
    </div>
  )
}
