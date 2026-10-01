// /EQUIPES V2 (Lot visuel 2026-10-01, polish FIX_REQUIRED 2026-10-01) — bloc
// KPI Organisation.
//
// Doctrine : 4 compteurs DESCRIPTIFS, état courant de l'organisation (pas une
// période) — jamais un classement inter-équipes. `teamsWithoutReferentCount`
// vient de `listTeamsWithMemberCount()` (toujours disponible), indépendant du
// pulse qui peut échouer (cf. INCIDENT /equipes 2026-09-30) : une panne du
// pulse ne doit jamais effacer cette carte.
//
// Rendu en puces compactes (pas des cartes pleine hauteur, cf. revue visuelle
// Vincent 2026-10-01) : 4 pastilles colorées sur une seule ligne, la carte ne
// doit jamais dominer la page.

import { Users, UserCheck, UserX, ShieldAlert } from 'lucide-react'
import type { TeamsGlobalPulse } from '@/lib/db/team-pulse'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  pulse: TeamsGlobalPulse | null
  teamsWithoutReferentCount: number
}

const TONE_CLASSES = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
  muted: 'bg-muted text-muted-foreground',
} as const

function KpiChip({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: React.ElementType
  value: number | null
  label: string
  tone: keyof typeof TONE_CLASSES
}) {
  const classes = TONE_CLASSES[value === null ? 'muted' : tone]
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${classes}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="tabular-nums font-semibold">{value === null ? '—' : value}</span>
      <span>{label}</span>
    </div>
  )
}

export function OrganisationKpiBlock({ pulse, teamsWithoutReferentCount }: Props) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Organisation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <KpiChip
          icon={Users}
          value={pulse ? pulse.activeTeamsCount : null}
          label={pulse && pulse.activeTeamsCount > 1 ? 'équipes actives' : 'équipe active'}
          tone="blue"
        />
        <KpiChip
          icon={UserCheck}
          value={pulse ? pulse.activePersonsInTeamsCount : null}
          label="en équipe"
          tone="green"
        />
        <KpiChip
          icon={UserX}
          value={pulse ? pulse.personsWithoutTeamCount : null}
          label="à affecter"
          tone="orange"
        />
        <KpiChip
          icon={ShieldAlert}
          value={teamsWithoutReferentCount}
          label={teamsWithoutReferentCount > 1 ? 'sans réf.' : 'sans réf.'}
          tone="violet"
        />
      </CardContent>
    </Card>
  )
}
