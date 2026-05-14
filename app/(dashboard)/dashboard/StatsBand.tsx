import type { ReactNode } from 'react'
import Link from 'next/link'
import { Activity, ShieldCheck, FileText, AlertTriangle, type LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type {
  WeekPulse,
  CapitalPreuves,
  AOPipeline,
  OpenAnomaliesStats,
} from '@/lib/db/dashboard'

interface StatsBandProps {
  weekPulse: WeekPulse
  capital: CapitalPreuves
  aoPipeline: AOPipeline
  anomalies: OpenAnomaliesStats
}

/**
 * Bandeau 4 stats du cockpit du matin (Slice 11.1).
 *
 * Responsive : 1 col mobile → 2 col sm → 4 col lg.
 * Chaque card affiche 3 mini-stats (ou état "Aucune" pour anomalies à 0).
 */
export function StatsBand({ weekPulse, capital, aoPipeline, anomalies }: StatsBandProps) {
  return (
    <div
      data-slot="stats-band"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
    >
      <StatCard icon={Activity} title="Cette semaine" testId="stat-week">
        <Stat value={weekPulse.interventionsExecuted} label="interventions" />
        <Stat value={weekPulse.photosCount} label="photos" />
        <Stat value={weekPulse.validationsCount} label="validations" />
        {weekPulse.unassignedCount > 0 && (
          <Link
            href="/semaine#vigilance-heading"
            className="block rounded hover:bg-muted/30 -mx-1 px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Voir le détail sur la page Semaine"
          >
            <Stat
              value={weekPulse.unassignedCount}
              label="sans équipe →"
              icon={AlertTriangle}
              tone="amber"
            />
          </Link>
        )}
        {weekPulse.conflictCount > 0 && (
          <Link
            href="/semaine#vigilance-heading"
            className="block rounded hover:bg-muted/30 -mx-1 px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Voir le détail sur la page Semaine"
          >
            <Stat
              value={weekPulse.conflictCount}
              label="conflit(s) équipe →"
              icon={AlertTriangle}
              tone="amber"
            />
          </Link>
        )}
      </StatCard>

      <StatCard icon={ShieldCheck} title="Capital de preuves" testId="stat-capital">
        <Stat value={capital.totalPhotos} label="photos cumulées" />
        <Stat value={capital.totalInterventionsExecuted} label="interventions" />
        <Stat value={capital.totalContractsActive} label="contrats actifs" />
      </StatCard>

      <StatCard icon={FileText} title="AO en cours" testId="stat-ao">
        <Stat value={aoPipeline.analyzing} label="en analyse" />
        <Stat value={aoPipeline.ready} label="prêt à soumettre" />
        <Stat value={aoPipeline.submitted} label="soumis" />
        {aoPipeline.renewalsDue > 0 && (
          <Stat
            value={aoPipeline.renewalsDue}
            label="à renouveler ≤ 60j"
            icon={AlertTriangle}
            tone="amber"
          />
        )}
      </StatCard>

      <StatCard icon={AlertTriangle} title="Anomalies ouvertes" testId="stat-anomalies">
        {anomalies.total === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune anomalie ouverte.</p>
        ) : (
          <>
            <Stat value={anomalies.total} label="ouvertes" />
            {anomalies.oldCount > 0 && (
              <Stat value={anomalies.oldCount} label="depuis +3 jours" muted />
            )}
          </>
        )}
      </StatCard>
    </div>
  )
}

interface StatCardProps {
  icon: LucideIcon
  title: string
  testId?: string
  children: ReactNode
}

function StatCard({ icon: Icon, title, testId, children }: StatCardProps) {
  return (
    <Card data-slot="stat-card" data-testid={testId}>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span>{title}</span>
        </div>
        <div className="space-y-0.5">{children}</div>
      </CardContent>
    </Card>
  )
}

interface StatProps {
  value: number
  label: string
  muted?: boolean
  icon?: LucideIcon
  tone?: 'default' | 'amber'
}

function Stat({ value, label, muted, icon: Icon, tone = 'default' }: StatProps) {
  const valueClass = muted
    ? 'tabular-nums font-semibold text-sm text-muted-foreground'
    : tone === 'amber'
      ? 'tabular-nums font-semibold text-lg text-amber-700'
      : 'tabular-nums font-semibold text-lg'
  const labelClass =
    tone === 'amber' ? 'text-xs text-amber-700' : 'text-xs text-muted-foreground'
  return (
    <div className="flex items-baseline gap-1.5">
      {Icon && (
        <Icon
          className={
            tone === 'amber'
              ? 'h-3.5 w-3.5 text-amber-600 self-center'
              : 'h-3.5 w-3.5 text-muted-foreground self-center'
          }
          aria-hidden
        />
      )}
      <span className={valueClass}>{value.toLocaleString('fr-FR')}</span>
      <span className={labelClass}>{label}</span>
    </div>
  )
}
