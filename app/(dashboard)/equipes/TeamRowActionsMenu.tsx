'use client'

// /EQUIPES V2 (polish FIX_REQUIRED 2026-10-01) — regroupe les 3 actions
// d'administration d'une équipe (apparence, accès application, archivage)
// derrière un menu « … » : la lecture de l'équipe doit dominer la ligne du
// tableau, l'administration reste disponible mais discrète (cf. revue
// visuelle Vincent 2026-10-01).
//
// Les 3 dialogs restent les composants existants, rendus ici en mode
// contrôlé (`hideTrigger` + `open`/`onOpenChange`) — pas de nouvelle
// mécanique de dialog, pas de DialogTrigger imbriqué dans un
// DropdownMenuItem (risque de conflit focus/portail entre les deux
// primitives base-ui).

import { useState } from 'react'
import { MoreVertical, Palette, Users, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EditTeamAppearanceButton } from './EditTeamAppearanceButton'
import { EditTeamMembersDialog, type MemberLite } from './EditTeamMembersDialog'
import { ArchiveTeamButton } from './ArchiveTeamButton'

interface Props {
  teamId: string
  teamName: string
  initialColor: string | null
  initialIcon: string | null
  members: MemberLite[]
  availableUsers: MemberLite[]
  dependencies: { missions: number; futureInterventions: number }
}

type DialogKind = 'appearance' | 'members' | 'archive' | null

export function TeamRowActionsMenu({
  teamId,
  teamName,
  initialColor,
  initialIcon,
  members,
  availableUsers,
  dependencies,
}: Props) {
  const [openDialog, setOpenDialog] = useState<DialogKind>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" data-testid={`team-actions-${teamId}`}>
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Actions sur l’équipe</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setOpenDialog('appearance')}>
            <Palette /> Apparence
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpenDialog('members')}>
            <Users /> Accès application
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setOpenDialog('archive')}>
            <Archive /> Archiver
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditTeamAppearanceButton
        teamId={teamId}
        initialName={teamName}
        initialColor={initialColor}
        initialIcon={initialIcon}
        hideTrigger
        open={openDialog === 'appearance'}
        onOpenChange={(o) => setOpenDialog(o ? 'appearance' : null)}
      />
      <EditTeamMembersDialog
        teamId={teamId}
        teamName={teamName}
        members={members}
        availableUsers={availableUsers}
        hideTrigger
        open={openDialog === 'members'}
        onOpenChange={(o) => setOpenDialog(o ? 'members' : null)}
      />
      <ArchiveTeamButton
        teamId={teamId}
        teamName={teamName}
        dependencies={dependencies}
        hideTrigger
        open={openDialog === 'archive'}
        onOpenChange={(o) => setOpenDialog(o ? 'archive' : null)}
      />
    </>
  )
}
