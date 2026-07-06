import { Footprints, Camera, ListChecks, ClipboardList } from 'lucide-react'
import type { SiteMemorySnapshot } from '@/lib/db/visits'

/**
 * « Mémoire » — le chantier parle de tout ce qu'il a accumulé DEPUIS SA CRÉATION :
 * visites, photos, actions, réserves. Déterministe (comptes réels), zéro IA. Ne
 * s'affiche que si le chantier a au moins une visite (sinon il n'a pas de mémoire).
 */
export function SiteMemoryCard({ snapshot }: { snapshot: SiteMemorySnapshot }) {
  if (snapshot.visits === 0) return null
  const cells: { Icon: typeof Camera; cls: string; n: number; label: string }[] = [
    { Icon: Footprints, cls: 'text-emerald-600', n: snapshot.visits, label: snapshot.visits > 1 ? 'visites' : 'visite' },
    { Icon: Camera, cls: 'text-violet-600', n: snapshot.photos, label: 'photos' },
    { Icon: ListChecks, cls: 'text-sky-600', n: snapshot.actions, label: 'actions' },
    { Icon: ClipboardList, cls: 'text-amber-600', n: snapshot.reserves, label: snapshot.reserves > 1 ? 'réserves' : 'réserve' },
  ]
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Mémoire
        {snapshot.sinceLabel && <span className="font-normal normal-case"> · depuis {snapshot.sinceLabel}</span>}
      </h2>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {cells.map(({ Icon, cls, n, label }) => (
          <div key={label} className="flex flex-col items-center gap-1 text-center">
            <Icon className={`h-5 w-5 ${cls}`} />
            <span className="text-lg font-semibold leading-none tabular-nums">{n}</span>
            <span className="text-[11px] leading-tight text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
