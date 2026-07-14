import Link from 'next/link'
import type { ReactNode } from 'react'
import { BookOpen, GitBranch, Search, Send, Users } from 'lucide-react'
import type { MemorySignal } from '@/lib/db/site-memory-signals'
import type { SubjectSummary } from '@/lib/db/subjects'
import type { DbHandoverBrief, DbTeam } from '@/types/db'
import { SiteMemoryQuery } from '../../SiteMemoryQuery'
import { PrepareSitePassationButton } from './PrepareSitePassationButton'

export interface SiteRelay {
  id: string
  name: string
  lastPassage: string | null
  interventions: number
}

export function MemoryWorkspace({
  siteId,
  siteName = 'ce chantier',
  signals,
  subjects,
  relays = [],
  teams = [],
  passations = [],
  traceCount = 0,
  questionSlot,
}: {
  siteId: string
  siteName?: string
  signals: MemorySignal[]
  subjects: SubjectSummary[]
  relays?: SiteRelay[]
  teams?: DbTeam[]
  passations?: DbHandoverBrief[]
  traceCount?: number
  questionSlot?: ReactNode
}) {
  return (
    <main className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Mémoire</h1>
          <p className="text-sm text-muted-foreground">Ici, je peux retrouver ce que le chantier sait.</p>
        </div>
        {/* Mode avancé, pas un sous-menu : l'atelier reste à portée sans occuper l'écran. */}
        <Link
          href={`/memoire/${siteId}`}
          className="w-fit shrink-0 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Atelier complet
        </Link>
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

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-[22px] border bg-card p-5 shadow-sm" aria-labelledby="important-knowledge-title">
          <div className="mb-4 flex items-start gap-3">
            <BookOpen className="mt-0.5 h-5 w-5 text-violet-600 dark:text-violet-300" />
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
            // Un état vide qui explique la différence entre une trace et une mémoire,
            // et qui propose l'étape suivante au lieu de constater le vide.
            <UsefulEmpty
              title="Aucune information n’a encore été marquée comme durable."
              detail={traceCount > 0
                ? `${traceCount} événement${traceCount > 1 ? 's existent' : ' existe'} dans la chronologie du chantier.`
                : 'Une trace devient durable lorsqu’elle est promue en décision, réserve ou obligation.'}
              action={traceCount > 0 ? { label: 'Ouvrir la chronologie', href: `/sites/${siteId}?tab=chronologie` } : null}
            />
          )}
        </section>

        <section className="rounded-[22px] border bg-card p-5 shadow-sm" aria-labelledby="living-subjects-title">
          <div className="mb-4 flex items-start gap-3">
            <GitBranch className="mt-0.5 h-5 w-5 text-violet-600 dark:text-violet-300" />
            <div>
              <h2 id="living-subjects-title" className="text-lg font-semibold">Dossiers vivants</h2>
              <p className="text-sm text-muted-foreground">L’histoire complète d’un problème : événements, décisions, actions et preuves.</p>
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
            <UsefulEmpty
              title="Aucun dossier vivant."
              detail="Un dossier regroupe les actions, preuves et décisions liées à un même problème."
              action={{ label: 'Voir les sujets du chantier', href: `/sites/${siteId}/subjects` }}
            />
          )}
        </section>
      </div>

      {/* Le relais est une question de mémoire (« qui connaît ce chantier ? »), pas une
          suggestion de recherche : il a sa place à part, jamais sous le champ. */}
      <section className="rounded-[22px] border bg-card p-5 shadow-sm" aria-labelledby="site-relays-title">
        <div className="mb-4 flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 text-violet-600 dark:text-violet-300" />
          <div>
            <h2 id="site-relays-title" className="text-lg font-semibold">Relais du chantier</h2>
            <p className="text-sm text-muted-foreground">Les équipes déjà venues ici. Descriptif, sans classement.</p>
          </div>
        </div>
        {relays.length > 0 ? (
          <ul className="divide-y rounded-2xl border">
            {relays.map((relay) => (
              <li key={relay.id} className="flex flex-col gap-1 p-4 md:flex-row md:items-center md:justify-between">
                <span className="font-medium">{relay.name}</span>
                <span className="text-sm text-muted-foreground">
                  {relay.lastPassage ? `Dernière présence le ${formatDate(relay.lastPassage)}` : 'Aucun passage daté'}
                  {' · '}
                  {relay.interventions} intervention{relay.interventions > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <UsefulEmpty
            title="Aucune équipe n’est encore venue sur ce chantier."
            detail="Le relais se construit dès la première intervention réalisée."
            action={null}
          />
        )}
      </section>

      {/* La passation n'est pas une donnée de structure : c'est une LECTURE CONDENSÉE
          de la mémoire du chantier. La mémoire répond « que sait ce chantier ? » ;
          la passation répond « que faut-il transmettre de ce savoir, maintenant ? ».
          Même domaine, donc même onglet — et un onglet réel, atteignable au doigt. */}
      <section className="rounded-[22px] border border-violet-100 bg-card p-5 shadow-sm dark:border-violet-950/50" aria-labelledby="passation-title">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Send className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300" />
            <div className="min-w-0">
              <h2 id="passation-title" className="text-lg font-semibold">Transmettre ce chantier</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tout ce qu&apos;il faut comprendre pour reprendre {siteName} sans repartir de zéro : situation,
                travail restant, réserves, décisions, prochaines échéances, équipes, documents, et ce qu&apos;il
                faut savoir du lieu.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <PrepareSitePassationButton siteId={siteId} siteName={siteName} teams={teams} />
          </div>
        </div>

        {passations.length > 0 && (
          <div className="mt-4 divide-y rounded-2xl border">
            {passations.map((brief) => (
              <Link
                key={brief.id}
                href={`/handovers/${brief.id}`}
                className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{brief.title}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {passationStatusLabel(brief.status)}
                    {brief.effective_date && ` · à partir du ${formatPassationDate(brief.effective_date)}`}
                  </span>
                </span>
                <span className="text-sm text-muted-foreground">Ouvrir</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function passationStatusLabel(status: string): string {
  if (status === 'shared') return 'Partagée'
  if (status === 'acknowledged') return 'Reçue et confirmée'
  if (status === 'archived') return 'Archivée'
  return 'Brouillon — pas encore partagée'
}

function formatPassationDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function UsefulEmpty({
  title,
  detail,
  action,
}: {
  title: string
  detail: string
  action: { label: string; href: string } | null
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-muted/20 p-5">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      {action && (
        <Link href={action.href} className="mt-3 inline-flex rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
          {action.label}
        </Link>
      )}
    </div>
  )
}

function displaySignalTitle(signal: MemorySignal): string {
  if (signal.kind === 'decision_unapplied') {
    const count = signal.items.length
    return `${count} décision${count > 1 ? 's' : ''} sans suite identifiée${count > 1 ? 's' : ''}`
  }
  return signal.title
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' })
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'récente'
  const days = Math.max(0, Math.round((Date.now() - date.getTime()) / 86_400_000))
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'il y a 1 j'
  return `il y a ${days} j`
}
