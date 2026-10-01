// /EQUIPES V2 (Lot visuel 2026-10-01) — bloc KPI Organisation.
//
// Doctrine : 4 compteurs DESCRIPTIFS, état courant de l'organisation (pas une
// période) — jamais un classement inter-équipes. `teamsWithoutReferentCount`
// vient de `listTeamsWithMemberCount()` (toujours disponible), indépendant du
// pulse qui peut échouer (cf. INCIDENT /equipes 2026-09-30) : une panne du
// pulse ne doit jamais effacer cette carte.

import { Users, UserCheck, UserX, ShieldAlert } from 'lucide-react'
import type { TeamsGlobalPulse } from '@/lib/db/team-pulse'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  pulse: TeamsGlobalPulse | null
  teamsWithoutReferentCount: number
}

function KpiCard({
  icon: Icon,
  value,
  label,
  sublabel,
  tone = 'default',
}: {
  icon: React.ElementType
  value: number | null
  label: string
  sublabel?: string
  tone?: 'default' | 'warning'
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            tone === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-brand-50 text-brand-700'
          }`}
        >
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold tabular-nums text-foreground">
            {value === null ? '—' : value}
          </div>
          <div className="text-xs text-muted-foreground">{label}</div>
          {sublabel && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{sublabel}</div>}
        </div>
      </CardContent>
    </Card>
  )
}

export function OrganisationKpiBlock({ pulse, teamsWithoutReferentCount }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        icon={Users}
        value={pulse ? pulse.activeTeamsCount : null}
        label={pulse && pulse.activeTeamsCount > 1 ? 'équipes actives' : 'équipe active'}
      />
      <KpiCard
        icon={UserCheck}
        value={pulse ? pulse.activePersonsInTeamsCount : null}
        label="personnes en équipe"
        sublabel={
          pulse
            ? `${pulse.activeAppUsersInTeamsCount} avec accès · ${pulse.activeFieldContactsInTeamsCount} terrain`
            : undefined
        }
      />
      <KpiCard icon={UserX} value={pulse ? pulse.personsWithoutTeamCount : null} label="sans équipe" />
      <KpiCard
        icon={ShieldAlert}
        value={teamsWithoutReferentCount}
        label={teamsWithoutReferentCount > 1 ? 'équipes sans référent' : 'équipe sans référent'}
        tone={teamsWithoutReferentCount > 0 ? 'warning' : 'default'}
      />
    </div>
  )
}
