import Link from 'next/link'
import { AlertTriangle, AlertCircle, Info, ChevronRight } from 'lucide-react'
import type { SiteStatusLine } from '@/lib/db/visits'

/**
 * « État du chantier » — le résumé en tête de fiche : en 10 secondes le conducteur
 * sait où il en est (actions en retard, réserves, dernière visite, réunion, photos)
 * sans parcourir plusieurs écrans. Déterministe. C'est le futur centre de gravité
 * de la fiche chantier.
 */
const TONE: Record<SiteStatusLine['tone'], { Icon: typeof Info; cls: string }> = {
  alert: { Icon: AlertCircle, cls: 'text-red-600 dark:text-red-400' },
  warn: { Icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400' },
  info: { Icon: Info, cls: 'text-muted-foreground' },
}

export function SiteStatusCard({ lines }: { lines: SiteStatusLine[] }) {
  if (lines.length === 0) return null
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">État du chantier</h2>
      <ul className="space-y-1.5">
        {lines.map((l, i) => {
          const { Icon, cls } = TONE[l.tone]
          const textCls = l.tone === 'info' ? 'text-foreground/90' : `font-medium ${cls}`
          return (
            <li key={i} className="text-sm">
              {l.href ? (
                <Link href={l.href} className="flex items-center gap-2 -mx-1 rounded-md px-1 py-0.5 active:bg-accent">
                  <Icon className={`h-4 w-4 shrink-0 ${cls}`} />
                  <span className={`flex-1 ${textCls}`}>{l.text}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Link>
              ) : (
                <span className="flex items-start gap-2">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} />
                  <span className={textCls}>{l.text}</span>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
