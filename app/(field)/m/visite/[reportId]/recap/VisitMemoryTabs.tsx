'use client'

// « Voir la visite » = la mémoire vivante du chantier, en 4 onglets (chacun répond
// à UNE question). L'écran de fin de visite reste ultra-rapide ; ICI on prend le
// temps de comprendre l'histoire. Cf. maquette Guillaume.
//   • Cette visite → « qu'est-ce que j'ai fait aujourd'hui ? »  (contenu serveur)
//   • Évolution    → « qu'est-ce qui a changé depuis la dernière fois ? »  (le diff)
//   • Histoire     → « comment le chantier a-t-il évolué ? »  (la frise)
//   • Mémoire      → « qu'est-ce que MemorIA sait de ce chantier ? »  (récurrences)

import { useState } from 'react'
import {
  BookOpen, TrendingUp, History, Brain, CheckCircle2, AlertTriangle, Eye, Camera,
  CalendarDays, ListTodo, Flag, Footprints, Users, Wrench, ClipboardList, CheckSquare,
  Compass, Trophy, Star,
} from 'lucide-react'
import type { VisitEvolution, SitePatrimoine } from '@/lib/db/visits'
import type { TimelineEvent, TimelineKind } from '@/lib/db/site-timeline'
import type { MemorySignal } from '@/lib/db/site-memory-signals'

type Tab = 'visite' | 'evolution' | 'histoire' | 'memoire'

const TABS: Array<{ key: Tab; label: string; Icon: typeof BookOpen }> = [
  { key: 'visite', label: 'Cette visite', Icon: BookOpen },
  { key: 'evolution', label: 'Évolution', Icon: TrendingUp },
  { key: 'histoire', label: 'Histoire', Icon: History },
  { key: 'memoire', label: 'Mémoire', Icon: Brain },
]

export function VisitMemoryTabs({
  evolution,
  timeline,
  currentReportId,
  memory,
  patrimoine,
  children,
}: {
  evolution: VisitEvolution
  timeline: TimelineEvent[]
  currentReportId: string
  memory: MemorySignal[]
  patrimoine: SitePatrimoine
  /** Onglet « Cette visite » — rendu côté serveur (contenu existant du récap). */
  children: React.ReactNode
}) {
  const [tab, setTab] = useState<Tab>('visite')

  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-24 pt-5">
      {tab === 'visite' && children}
      {tab === 'evolution' && <EvolutionPanel e={evolution} />}
      {tab === 'histoire' && <HistoirePanel timeline={timeline} currentReportId={currentReportId} />}
      {tab === 'memoire' && <MemoirePanel memory={memory} patrimoine={patrimoine} />}

      {/* Barre d'onglets — une main, en bas du pouce. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur safe-bottom">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${active ? 'text-emerald-600' : 'text-muted-foreground'}`}
              >
                <Icon className="h-5 w-5" /> {label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

// ── Onglet 2 — Évolution (le diff depuis la dernière visite) ──────────────────

function EvolutionPanel({ e }: { e: VisitEvolution }) {
  if (!e.hasPrev) {
    return (
      <div className="space-y-4">
        <PanelTitle title="Évolution" subtitle="Depuis la dernière visite" />
        <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Flag className="mb-1.5 h-5 w-5 text-emerald-600" />
          <p className="font-medium text-foreground">Première visite</p>
          <p>Pas encore de comparaison possible. Cette visite devient le <strong>point de référence</strong> du chantier.</p>
        </div>
      </div>
    )
  }
  const nothing = e.resolvedReserves.length === 0 && e.newReserves.length === 0 && e.recurring.length === 0 && e.addedPhotos === 0
  return (
    <div className="space-y-4">
      <PanelTitle title="Évolution" subtitle={`Depuis la dernière visite (${e.prevDateLabel})`} />
      {nothing ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">Rien de notable n&apos;a changé depuis la dernière visite.</p>
      ) : (
        <ul className="space-y-2">
          {e.resolvedReserves.map((r, i) => (
            <Row key={`res-${i}`} icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} title={`${r.label}`} sub={r.location ? `${r.location} — réserve levée` : 'Réserve levée'} />
          ))}
          {e.newReserves.map((r, i) => (
            <Row key={`new-${i}`} icon={<AlertTriangle className="h-5 w-5 text-rose-600" />} title={r.label} sub={r.location ? `${r.location} — nouvelle réserve` : 'Nouvelle réserve'} />
          ))}
          {e.recurring.map((r, i) => (
            <Row key={`rec-${i}`} icon={<Eye className="h-5 w-5 text-amber-600" />} title={r.label} sub={r.detail ?? 'Toujours présent'} />
          ))}
          {e.addedPhotos > 0 && (
            <Row icon={<Camera className="h-5 w-5 text-sky-600" />} title={`+${e.addedPhotos} nouvelle${e.addedPhotos > 1 ? 's' : ''} preuve${e.addedPhotos > 1 ? 's' : ''}`} sub="Depuis la dernière visite" />
          )}
        </ul>
      )}
    </div>
  )
}

// ── Onglet 3 — Histoire (la VRAIE frise, visites incluses) ────────────────────

const HIST_META: Record<TimelineKind, { Icon: typeof Users; cls: string; ring: string }> = {
  visit: { Icon: Footprints, cls: 'text-emerald-600', ring: 'bg-emerald-100 dark:bg-emerald-950/40' },
  meeting: { Icon: Users, cls: 'text-sky-600', ring: 'bg-sky-100 dark:bg-sky-950/40' },
  intervention: { Icon: Wrench, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40' },
  reserve_open: { Icon: ClipboardList, cls: 'text-rose-600', ring: 'bg-rose-100 dark:bg-rose-950/40' },
  reserve_lifted: { Icon: CheckCircle2, cls: 'text-emerald-600', ring: 'bg-emerald-100 dark:bg-emerald-950/40' },
  action_done: { Icon: CheckSquare, cls: 'text-slate-600', ring: 'bg-slate-100 dark:bg-slate-800/60' },
  decision: { Icon: Compass, cls: 'text-violet-600', ring: 'bg-violet-100 dark:bg-violet-950/40' },
  phase: { Icon: Trophy, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40' },
}

function HistoirePanel({ timeline, currentReportId }: { timeline: TimelineEvent[]; currentReportId: string }) {
  const currentHref = `/m/visite/${currentReportId}/recap`
  return (
    <div className="space-y-4">
      <PanelTitle title="Histoire du chantier" subtitle="Votre visite vient d'entrer dans l'histoire" />
      {timeline.length === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">L&apos;histoire du chantier commence avec cette visite.</p>
      ) : (
        <ol className="relative space-y-2.5 pl-1">
          {/* fil vertical de la frise */}
          <span aria-hidden className="absolute left-[18px] top-3 bottom-3 w-px bg-border" />
          {timeline.map((ev, i) => {
            const isCurrent = ev.href === currentHref
            const { Icon, cls, ring } = HIST_META[ev.kind] ?? HIST_META.decision
            return (
              <li key={i} className="relative flex items-start gap-3">
                <span className={`relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isCurrent ? 'ring-2 ring-emerald-500' : ''} ${ring}`}>
                  <Icon className={`h-[18px] w-[18px] ${cls}`} />
                  {ev.star && <Star className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                </span>
                <div className={`min-w-0 flex-1 rounded-xl border p-3 ${isCurrent ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20' : 'bg-background'}`}>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="min-w-0 truncate">{ev.title}</span>
                    {isCurrent && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">Aujourd&apos;hui</span>
                    )}
                  </p>
                  {ev.detail && <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{ev.detail}</p>}
                  <p className="mt-0.5 text-[12px] text-muted-foreground first-letter:uppercase">{ev.dateLabel}</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

// ── Onglet 4 — Mémoire (récurrences + patrimoine) ─────────────────────────────

const SIGNAL_ICON: Record<string, typeof Eye> = {
  recurring_topic: Eye, action_overdue: ListTodo, action_recurring: ListTodo,
  reserve_open: AlertTriangle, actor_congestion: TrendingUp, actor_absent: TrendingUp,
  decision_unapplied: CalendarDays, obligation_neglected: AlertTriangle,
}

function MemoirePanel({ memory, patrimoine }: { memory: MemorySignal[]; patrimoine: SitePatrimoine }) {
  return (
    <div className="space-y-4">
      <PanelTitle title="Mémoire du chantier" subtitle="Ce que MemorIA a retenu" />
      {memory.length === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">Pas encore de récurrence détectée — la mémoire se construit visite après visite.</p>
      ) : (
        <ul className="space-y-2">
          {memory.map((s, i) => {
            const Icon = SIGNAL_ICON[s.kind] ?? Brain
            return (
              <li key={i} className="rounded-xl border bg-background p-3">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 text-muted-foreground"><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{s.title}</p>
                    {s.items.slice(0, 3).map((it) => (
                      <p key={it.id} className="text-[13px] text-muted-foreground">
                        {it.label}{it.meta ? ` — ${it.meta}` : ''}
                      </p>
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Patrimoine — pas des KPI, un patrimoine accumulé. */}
      <div className="rounded-xl border bg-muted/20 p-3">
        <p className="text-sm font-semibold">Patrimoine du chantier</p>
        {patrimoine.firstVisitLabel && (
          <p className="text-[12px] text-muted-foreground">Depuis la première visite ({patrimoine.firstVisitLabel})</p>
        )}
        <div className="mt-2 grid grid-cols-4 gap-2 text-center">
          <Stat n={patrimoine.photos} label="photos" />
          <Stat n={patrimoine.visits} label="visites" />
          <Stat n={patrimoine.actions} label="actions" />
          <Stat n={patrimoine.reserves} label="réserves" />
        </div>
      </div>
    </div>
  )
}

// ── Petits éléments partagés ──────────────────────────────────────────────────

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-[13px] text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function Row({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <li className="flex items-start gap-2.5 rounded-xl border bg-background p-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{title}</p>
        <p className="text-[12px] text-muted-foreground">{sub}</p>
      </div>
    </li>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums">{n}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
