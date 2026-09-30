// /EQUIPES V2 — FIX 7 (revue ChatGPT/Vincent, cd30aa2d) — Pulse global compact.
//
// Doctrine V2 : une seule bande descriptive, PAS de classement, PAS de
// « meilleure équipe ». `planned` ne compte jamais comme réalisé — les
// compteurs d'activité viennent exclusivement de getTeamsGlobalPulse
// (lib/db/team-pulse.ts), qui sépare déjà réel/prévu.

import type { TeamsGlobalPulse } from '@/lib/db/team-pulse'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  // INCIDENT /equipes (2026-09-30) — `null` = le pulse a échoué côté serveur
  // (cf. page.tsx, .catch() dédié). Jamais de faux compteurs à 0 : on affiche
  // un état dégradé explicite, la page reste utilisable pour autant.
  pulse: TeamsGlobalPulse | null
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-base font-semibold text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

export function TeamsGlobalPulseRow({ pulse }: Props) {
  if (!pulse) {
    return (
      <Card className="bg-muted/30">
        <CardContent className="py-3 text-xs text-muted-foreground">
          Indicateurs indisponibles pour l’instant.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-muted/30">
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
        <Stat value={pulse.activeTeamsCount} label={pulse.activeTeamsCount > 1 ? 'équipes actives' : 'équipe active'} />
        <Stat value={pulse.activePersonsInTeamsCount} label="personnes en équipe" />
        <Stat value={pulse.personsWithoutTeamCount} label="sans équipe" />
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
        <Stat value={pulse.realInterventionsCount} label={`interventions réalisées (${pulse.periodDays} j)`} />
        <Stat value={pulse.sitesReallyCoveredCount} label={`sites couverts (${pulse.periodDays} j)`} />
        <Stat value={pulse.terrainPhotosCount} label={`photos terrain (${pulse.periodDays} j)`} />
      </CardContent>
    </Card>
  )
}
