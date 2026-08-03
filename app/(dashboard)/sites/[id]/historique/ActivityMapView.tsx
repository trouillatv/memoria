import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActivityMap, ActivityCellState } from '@/lib/documents/site-synthesis'

interface Props {
  activityMap: ActivityMap
  siteId: string
}

function formatRunDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function ActivityDot({ state }: { state: ActivityCellState }) {
  switch (state) {
    case 'absent':
      return <span className="text-muted-foreground/30 text-base leading-none select-none">–</span>
    case 'first':
      return <span className="text-blue-500 text-base leading-none select-none" title="Apparition">○</span>
    case 'open':
      return <span className="text-muted-foreground text-base leading-none select-none" title="Ouvert">●</span>
    case 'non_compliant':
      return <span className="text-red-500 text-base leading-none font-bold select-none" title="Non conforme">⚠</span>
    case 'done':
      return <span className="text-green-600 text-base leading-none select-none" title="Traité">✓</span>
    case 'reopened':
      return <span className="text-orange-500 text-base leading-none select-none" title="Réouvert">↩</span>
  }
}

export function ActivityMapView({ activityMap, siteId }: Props) {
  const { runs, rows } = activityMap

  if (rows.length === 0) {
    return (
      <section className="rounded-[22px] border border-dashed bg-card p-8 text-center shadow-sm">
        <p className="font-medium">Aucun sujet à afficher.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Les sujets apparaissent lorsque des PV ont été analysés et que des sujets canoniques sont identifiés.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-[22px] border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="sticky left-0 z-10 bg-muted/40 px-4 py-3 text-left font-medium text-muted-foreground min-w-[200px]">
                Sujet
              </th>
              {runs.map((run) => (
                <th key={run.id} className="px-2 py-3 text-center font-medium text-muted-foreground min-w-[52px]">
                  <div className="text-xs">PV{run.pvNumber}</div>
                  <div className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                    {formatRunDate(run.effectiveDate)}
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 text-left font-medium text-muted-foreground min-w-[120px]">
                Travaux
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.canonicalSubjectId}
                className={cn(
                  'border-b last:border-0 hover:bg-muted/20 transition-colors',
                  i % 2 !== 0 && 'bg-muted/10',
                )}
              >
                <td className="sticky left-0 z-10 bg-card px-4 py-3">
                  <Link
                    href={`/sites/${siteId}/historique/sujets/${row.canonicalSubjectId}`}
                    className="flex items-start gap-1 font-medium hover:text-primary transition-colors"
                  >
                    <span className="line-clamp-2 leading-snug">{row.label}</span>
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {row.hasActions && (
                      <span className="text-[10px] rounded px-1 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        Act.
                      </span>
                    )}
                    {row.hasReserves && (
                      <span className="text-[10px] rounded px-1 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        Rés.
                      </span>
                    )}
                    {row.hasDecisions && (
                      <span className="text-[10px] rounded px-1 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        Déc.
                      </span>
                    )}
                    {row.hasDeadlines && (
                      <span className="text-[10px] rounded px-1 py-0.5 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                        Éch.
                      </span>
                    )}
                  </div>
                </td>
                {row.cells.map((cell, j) => (
                  <td key={j} className="px-2 py-3 text-center">
                    <ActivityDot state={cell.state} />
                  </td>
                ))}
                <td className="px-3 py-3">
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    {row.openActions > 0 && (
                      <div>{row.openActions} action{row.openActions > 1 ? 's' : ''}</div>
                    )}
                    {row.openReserves > 0 && (
                      <div>{row.openReserves} réserve{row.openReserves > 1 ? 's' : ''}</div>
                    )}
                    {row.overdueDeadlines > 0 && (
                      <div className="text-red-500">⚠ {row.overdueDeadlines} en retard</div>
                    )}
                    {row.activeDeadlines > row.overdueDeadlines && (
                      <div>
                        {row.activeDeadlines - row.overdueDeadlines} échéance
                        {row.activeDeadlines - row.overdueDeadlines > 1 ? 's' : ''}
                      </div>
                    )}
                    {row.openActions === 0 && row.openReserves === 0 && row.activeDeadlines === 0 && (
                      <div className="text-muted-foreground/40">—</div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t px-4 py-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="text-blue-500">○</span> Apparition
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">●</span> Ouvert
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-red-500">⚠</span> Non conforme
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-orange-500">↩</span> Réouvert
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-green-600">✓</span> Traité
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground/30">–</span> Absent
        </span>
      </div>
    </section>
  )
}
