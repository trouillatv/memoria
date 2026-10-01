// /EQUIPES V2 (Lot visuel 2026-10-01) — bloc Mémoire terrain.
//
// Doctrine : compteurs RÉELS (jamais `planned`) sur une période choisie par
// l'utilisateur. INCIDENT /equipes (2026-09-30) — pulse peut être `null`
// (échec serveur, enrichissement non-bloquant) : état dégradé explicite,
// jamais de faux zéros. Et quand le pulse répond mais que la période est
// réellement vide d'activité, un empty-state élégant — jamais trois cartes
// à 0 qui donnent l'impression d'un bug.

import { ClipboardList, MapPin, Camera } from 'lucide-react'
import type { TeamsGlobalPulse } from '@/lib/db/team-pulse'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PulsePeriodSelect } from './PulsePeriodSelect'
import type { PulsePeriod } from '@/lib/db/team-pulse'

interface Props {
  pulse: TeamsGlobalPulse | null
  period: PulsePeriod
}

function MiniStat({ icon: Icon, value, label }: { icon: React.ElementType; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <span className="text-base font-semibold tabular-nums text-foreground">{value}</span>
        <span className="ml-1.5 text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

export function MemoireTerrainBlock({ pulse, period }: Props) {
  const hasActivity =
    !!pulse &&
    (pulse.realInterventionsCount > 0 || pulse.sitesReallyCoveredCount > 0 || pulse.terrainPhotosCount > 0)

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-sm font-semibold">Mémoire terrain</CardTitle>
        <PulsePeriodSelect period={period} />
      </CardHeader>
      <CardContent>
        {!pulse ? (
          <p className="py-1 text-xs text-muted-foreground">Indicateurs indisponibles pour l’instant.</p>
        ) : !hasActivity ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5 shrink-0" />
            Pas encore d’activité réelle sur cette période.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <MiniStat icon={ClipboardList} value={pulse.realInterventionsCount} label="interventions réalisées" />
            <MiniStat icon={MapPin} value={pulse.sitesReallyCoveredCount} label="sites couverts" />
            <MiniStat icon={Camera} value={pulse.terrainPhotosCount} label="photos terrain" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
