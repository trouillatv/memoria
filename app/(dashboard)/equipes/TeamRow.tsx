'use client'

// /EQUIPES V2 — ligne équipe dépliable (lot cockpit équipes 2026-10-01, items
// 1/2/3/4/8/10 du mandat Vincent).
//
// Remplace l'ancien lien "+ N autres" qui renvoyait vers la fiche équipe
// (`/equipes?team=<id>&tab=membres`) par une expansion EN PLACE : la
// composition complète (accès appli + terrain) se déplie sous la ligne,
// jamais via navigation. La fiche équipe complète (Aperçu/Activité/Mémoire)
// reste accessible via le badge équipe — seule la consultation de la
// composition ne nécessite plus de quitter /equipes.
//
// Doctrine inchangée : la date d'entrée affichée (`joined_at`) est une donnée
// réelle (défaut DB `now()`, jamais fabriquée/rétrodatée) — jamais une preuve
// de présence sur une intervention, uniquement une composition déclarée dans
// le temps.

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ClipboardList, MapPin, Camera, Repeat2, UserPlus } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { TableRow, TableCell } from '@/components/ui/table'
import { TeamBadge } from '@/components/ui/team-badge'
import { TeamReferentEditor } from './TeamReferentEditor'
import { EditTeamMembersDialog, type MemberLite } from './EditTeamMembersDialog'
import { AddFieldPersonDialog } from './[id]/AddFieldPersonDialog'
import { RemoveFieldMemberButton } from './RemoveFieldMemberButton'
import { TeamRowActionsMenu } from './TeamRowActionsMenu'
import type { TeamWithMemberCount } from '@/lib/db/teams'
import type { TeamActivitySummary } from '@/lib/db/team-activity-summary'

export interface ExpandedPerson {
  id: string
  kind: 'user' | 'contact'
  name: string
  joinedAt: string | null
  isReferent: boolean
  job?: string | null
  companyName?: string | null
  /** Terrain uniquement — id de l'appartenance, pour le retrait. */
  membershipId?: string
}

export interface TeamRowData {
  team: TeamWithMemberCount
  members: MemberLite[]
  expandedPeople: ExpandedPerson[]
  deps: { missions: number; futureInterventions: number }
  referent: { id: string; name: string } | null
  totalPersons: number
  summary: TeamActivitySummary | undefined
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

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ExpandedPanel({
  teamId,
  teamName,
  members,
  availableUsers,
  people,
}: {
  teamId: string
  teamName: string
  members: MemberLite[]
  availableUsers: MemberLite[]
  people: ExpandedPerson[]
}) {
  const appPeople = people.filter((p) => p.kind === 'user')
  const fieldPeople = people.filter((p) => p.kind === 'contact')

  return (
    <div className="space-y-3 py-2">
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Aucun membre pour l&apos;instant.</p>
      ) : (
        <div className="space-y-3">
          {appPeople.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">
                Avec accès à l&apos;application
              </p>
              <ul className="space-y-1.5">
                {appPeople.map((p) => (
                  <li key={`user:${p.id}`} className="flex items-center gap-2">
                    <Link
                      href={`/equipes?person=${p.id}&personKind=user&team=${teamId}`}
                      className="flex items-center gap-2 hover:text-brand-700 transition-colors"
                    >
                      <Avatar size="sm">
                        <AvatarFallback>{initials(p.name)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{p.name}</span>
                    </Link>
                    {p.isReferent && (
                      <span className="text-[9px] uppercase tracking-wider font-medium px-1 py-0.5 rounded bg-brand-50 text-brand-700 dark:bg-brand-600/10">
                        Réf.
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      Depuis le {fmtDateShort(p.joinedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fieldPeople.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">
                Membres terrain (sans compte)
              </p>
              <ul className="space-y-1.5">
                {fieldPeople.map((p) => (
                  <li key={`contact:${p.id}`} className="flex items-center gap-2">
                    <Link
                      href={`/equipes?person=${p.id}&personKind=contact&team=${teamId}`}
                      className="flex items-center gap-2 hover:text-brand-700 transition-colors"
                    >
                      <Avatar size="sm">
                        <AvatarFallback>{initials(p.name)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm">
                        {p.name}
                        {p.job && <span className="text-muted-foreground"> — {p.job}</span>}
                        {p.companyName && <span className="text-muted-foreground"> ({p.companyName})</span>}
                      </span>
                    </Link>
                    <span className="text-[9px] uppercase tracking-wider font-medium px-1 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-600/10 dark:text-amber-300">
                      Terrain
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Depuis le {fmtDateShort(p.joinedAt)}
                    </span>
                    {p.membershipId && (
                      <RemoveFieldMemberButton teamId={teamId} membershipId={p.membershipId} name={p.name} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Les deux populations restent distinctes (accès appli / terrain sans
          compte) — jamais fusionnées, cf. items 8/9 du mandat. */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <EditTeamMembersDialog
          teamId={teamId}
          teamName={teamName}
          members={members}
          availableUsers={availableUsers}
          trigger={
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline underline-offset-2 hover:no-underline dark:text-brand-300"
            >
              <UserPlus className="h-3.5 w-3.5" /> Ajouter une personne (accès appli)
            </button>
          }
        />
        <AddFieldPersonDialog teamId={teamId} teamName={teamName} />
      </div>
    </div>
  )
}

export function TeamRowDesktop({ row, availableUsers }: { row: TeamRowData; availableUsers: MemberLite[] }) {
  const { team, members, expandedPeople, deps, referent, totalPersons, summary } = row
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <TableRow data-slot="team-row" data-team-id={team.id}>
        <TableCell className="w-px">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Replier la composition' : 'Déplier la composition'}
            className="flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </TableCell>
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
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-left text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
          >
            {totalPersons === 0 ? 'Aucun membre' : `${totalPersons} personne${totalPersons > 1 ? 's' : ''}`}
          </button>
        </TableCell>
        <TableCell>
          <TeamReferentEditor teamId={team.id} teamName={team.name} current={referent} members={members} />
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {summary?.realInterventionsCount ? (
            <span className="inline-flex items-center justify-end gap-1 text-foreground">
              {summary.realInterventionsCount}
              <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {summary?.sitesReallyCoveredCount ? (
            <span className="inline-flex items-center justify-end gap-1 text-foreground">
              {summary.sitesReallyCoveredCount}
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {summary?.terrainPhotosCount ? (
            <span className="inline-flex items-center justify-end gap-1 text-foreground">
              {summary.terrainPhotosCount}
              <Camera className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {summary?.activeRotationCount ? (
            <span className="inline-flex items-center justify-end gap-1 text-foreground">
              {summary.activeRotationCount}
              <Repeat2 className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          )}
        </TableCell>
        <TableCell>
          <TeamRowActionsMenu
            teamId={team.id}
            teamName={team.name}
            initialColor={team.color}
            initialIcon={team.icon}
            members={members}
            availableUsers={availableUsers}
            dependencies={deps}
          />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow data-slot="team-row-expanded" data-team-id={`${team.id}-expanded`}>
          <TableCell colSpan={9} className="bg-muted/20">
            <ExpandedPanel
              teamId={team.id}
              teamName={team.name}
              members={members}
              availableUsers={availableUsers}
              people={expandedPeople}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export function TeamRowMobile({ row, availableUsers }: { row: TeamRowData; availableUsers: MemberLite[] }) {
  const { team, members, expandedPeople, deps, referent, totalPersons, summary } = row
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="space-y-2.5 p-3" data-slot="team-card" data-team-id={team.id}>
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
          dependencies={deps}
        />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        {totalPersons === 0 ? 'Aucun membre' : `${totalPersons} personne${totalPersons > 1 ? 's' : ''}`}
      </button>

      <TeamReferentEditor teamId={team.id} teamName={team.name} current={referent} members={members} />

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

      {/* Dépliant pleine largeur — jamais une table à défilement horizontal
          (item 10 du mandat). */}
      {expanded && (
        <div className="rounded-md border bg-muted/20 px-2">
          <ExpandedPanel
            teamId={team.id}
            teamName={team.name}
            members={members}
            availableUsers={availableUsers}
            people={expandedPeople}
          />
        </div>
      )}
    </div>
  )
}
