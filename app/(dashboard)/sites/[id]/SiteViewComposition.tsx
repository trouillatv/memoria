import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  BookOpen,
  History,
} from 'lucide-react'

export function SiteChronologyComposition({
  siteId,
  children,
}: {
  siteId: string
  children?: ReactNode
}) {
  return (
    <main className="space-y-5">
      <section className="flex flex-col gap-4 rounded-[22px] border bg-card px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900">
            <History className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Chronologie</h1>
            <p className="mt-1 text-sm text-muted-foreground">Tout ce qui s'est passé sur ce chantier, dans l'ordre.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/sites/${siteId}?tab=chronologie`} className="rounded-full bg-foreground px-3 py-1.5 text-sm font-medium text-background">
            Flux
          </Link>
          <Link href={`/sites/${siteId}/recit`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted">
            <BookOpen className="h-4 w-4" />
            Lire le récit
          </Link>
        </div>
      </section>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Flux</h2>
            <p className="text-sm text-muted-foreground">
              Visites, réunions, interventions, décisions, preuves, actions, réserves et blocages.
            </p>
          </div>
          <InlinePills items={['Tous', 'Visites', 'Réunions', 'Actions', 'Interventions', 'Preuves']} />
        </div>
        {children}
      </section>
    </main>
  )
}

function InlinePills({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span
          key={item}
          className={index === 0
            ? 'rounded-full border bg-foreground px-3 py-1.5 text-sm text-background'
            : 'rounded-full border px-3 py-1.5 text-sm text-muted-foreground'}
        >
          {item}
        </span>
      ))}
    </div>
  )
}
