import Link from 'next/link'
import type { ReactNode } from 'react'
import { BookOpen, GitBranch, Search } from 'lucide-react'
import type { MemorySignal } from '@/lib/db/site-memory-signals'
import type { SubjectSummary } from '@/lib/db/subjects'
import { SiteMemoryQuery } from '../../SiteMemoryQuery'

export function MemoryWorkspace({
  siteId,
  signals,
  subjects,
  questionSlot,
}: {
  siteId: string
  signals: MemorySignal[]
  subjects: SubjectSummary[]
  questionSlot?: ReactNode
}) {
  return (
    <main className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Mémoire</h1>
        <p className="text-sm text-muted-foreground">Ici, je peux retrouver ce que le chantier sait.</p>
      </header>

      <section className="rounded-[22px] border border-violet-100 bg-card p-5 shadow-sm dark:border-violet-950/50" aria-labelledby="memory-question-title">
        <div className="mb-4 flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 ring-1 ring-violet-100 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900">
            <Search className="h-5 w-5" />
          </span>
          <div>
            <h2 id="memory-question-title" className="text-lg font-semibold">Poser une question</h2>
            <p className="text-sm text-muted-foreground">La recherche utilise les traces réelles du chantier.</p>
          </div>
        </div>
        {questionSlot ?? <SiteMemoryQuery siteId={siteId} />}
      </section>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm" aria-labelledby="important-knowledge-title">
        <div className="mb-4 flex items-start gap-3">
          <BookOpen className="mt-0.5 h-5 w-5 text-violet-600" />
          <div>
            <h2 id="important-knowledge-title" className="text-lg font-semibold">Connaissances importantes</h2>
            <p className="text-sm text-muted-foreground">Éléments durables détectés dans les actions, décisions, réserves et obligations.</p>
          </div>
        </div>
        {signals.length > 0 ? (
          <div className="divide-y rounded-2xl border">
            {signals.slice(0, 5).map((signal) => (
              <article key={`${signal.kind}-${signal.title}`} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{displaySignalTitle(signal)}</h3>
                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700 ring-1 ring-violet-100 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900">
                    {signal.items.length}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {signal.items.slice(0, 3).map((item) => (
                    <li key={item.id} className="text-sm text-muted-foreground">
                      <span className="text-foreground">{item.label}</span>
                      {item.meta && <span> · {item.meta}</span>}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Aucune connaissance durable pour le moment.
          </p>
        )}
      </section>

      <section className="rounded-[22px] border bg-card p-5 shadow-sm" aria-labelledby="living-subjects-title">
        <div className="mb-4 flex items-start gap-3">
          <GitBranch className="mt-0.5 h-5 w-5 text-violet-600" />
          <div>
            <h2 id="living-subjects-title" className="text-lg font-semibold">Dossiers vivants</h2>
            <p className="text-sm text-muted-foreground">Problèmes ou sujets suivis qui relient événements, décisions, actions et preuves.</p>
          </div>
        </div>
        {subjects.length > 0 ? (
          <div className="divide-y rounded-2xl border">
            {subjects.slice(0, 5).map((subject) => (
              <Link
                key={subject.id}
                href={`/sites/${siteId}/subjects/${subject.id}`}
                className="block p-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium">{subject.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{subject.lastActivity ? `Dernière évolution ${formatRelative(subject.lastActivity)}` : 'Aucune évolution datée'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border px-2 py-1">{subject.openActions} action{subject.openActions > 1 ? 's' : ''}</span>
                    <span className="rounded-full border px-2 py-1">{subject.openReserves} réserve{subject.openReserves > 1 ? 's' : ''}</span>
                    <span className="rounded-full border px-2 py-1">{subject.documents} preuve{subject.documents > 1 ? 's' : ''}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Aucun dossier vivant pour l'instant. Un dossier regroupe les traces, décisions et actions liées à un même problème.
          </p>
        )}
      </section>
    </main>
  )
}

function displaySignalTitle(signal: MemorySignal): string {
  if (signal.kind === 'decision_unapplied') {
    const count = signal.items.length
    return `${count} décision${count > 1 ? 's' : ''} sans suite identifiée${count > 1 ? 's' : ''}`
  }
  return signal.title
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'récente'
  const days = Math.max(0, Math.round((Date.now() - date.getTime()) / 86_400_000))
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'il y a 1 j'
  return `il y a ${days} j`
}
