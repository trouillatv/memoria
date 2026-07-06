'use client'

// « Voir la visite » = la mémoire vivante du chantier, en 4 onglets qui forment UN
// PARCOURS de compréhension : Capture → Impact → Historique → Mémoire. L'écran de
// fin de visite reste ultra-rapide ; ICI on prend le temps de comprendre.
//
// Grammaire COMMUNE aux 4 onglets (pour que ce soit UN produit, pas 4 écrans) :
//   • un en-tête chantier partagé ;
//   • un fil de progression (Capture → Impact → Historique → Mémoire) ;
//   • un titre gris en capitales + une QUESTION à laquelle l'onglet répond ;
//   • les mêmes cartes (rayon, marges, pastille d'icône) ;
//   • un encart de CONCLUSION, différent mais cohérent d'un onglet à l'autre.

import { Fragment, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen, TrendingUp, History, Brain, CheckCircle2, AlertTriangle, Eye, Camera,
  CalendarDays, ListTodo, Footprints, Users, Wrench, ClipboardList, CheckSquare,
  Compass, Trophy, Star, ArrowLeft, ChevronRight, FileText,
} from 'lucide-react'
import type { VisitProduction, SitePatrimoine } from '@/lib/db/visits'
import type { TimelineEvent, TimelineKind } from '@/lib/db/site-timeline'
import type { MemorySignal } from '@/lib/db/site-memory-signals'

type Tab = 'visite' | 'evolution' | 'histoire' | 'memoire'

/**
 * Le PARCOURS — source unique de la grammaire des onglets. Chaque étape porte son
 * mot de progression, son intitulé, la QUESTION à laquelle elle répond et sa
 * CONCLUSION. Changer le récit ici le change partout : un seul produit.
 */
const JOURNEY: Array<{
  key: Tab
  label: string       // onglet (barre du bas)
  step: string        // fil de progression
  Icon: typeof BookOpen
  question: string    // la phrase-question en tête d'onglet
  lead: string        // la NARRATION du chapitre (« Voilà… ») — 5 angles, 1 histoire
  conclusion: { Icon: typeof BookOpen; text: string }
}> = [
  {
    key: 'visite', label: 'Cette visite', step: 'Capture', Icon: BookOpen,
    question: 'Qu’avons-nous capturé ?',
    lead: 'Voilà exactement ce que vous avez capturé aujourd’hui.',
    conclusion: { Icon: FileText, text: 'Le compte-rendu est prêt.' },
  },
  {
    key: 'evolution', label: 'Impact', step: 'Impact', Icon: TrendingUp,
    question: 'Qu’a changé cette visite ?',
    lead: 'Voilà ce que cette visite a changé sur le chantier.',
    conclusion: { Icon: TrendingUp, text: 'Cette visite a enrichi le dossier du chantier.' },
  },
  {
    key: 'histoire', label: 'Historique', step: 'Historique', Icon: History,
    question: 'Où s’inscrit cette visite dans la vie du chantier ?',
    lead: 'Voilà où cette visite vient s’inscrire dans la vie du chantier.',
    conclusion: { Icon: History, text: 'Cette visite fait désormais partie de l’histoire du chantier.' },
  },
  {
    key: 'memoire', label: 'Mémoire', step: 'Mémoire', Icon: Brain,
    question: 'Que retient désormais MemorIA ?',
    lead: 'Voilà ce que MemorIA retiendra dans cinq ans.',
    conclusion: { Icon: Brain, text: 'Cette connaissance sera réutilisée lors des prochaines visites et réunions.' },
  },
]

export function VisitMemoryTabs({
  siteId,
  siteName,
  visitTypeLabel,
  production,
  timeline,
  currentReportId,
  memory,
  patrimoine,
  justSaved = false,
  children,
}: {
  siteId: string
  siteName: string
  visitTypeLabel: string
  production: VisitProduction | null
  timeline: TimelineEvent[]
  currentReportId: string
  memory: MemorySignal[]
  patrimoine: SitePatrimoine
  /** true = on arrive de FINIR la visite (?saved=1) → bandeau de satisfaction. */
  justSaved?: boolean
  /** Onglet « Cette visite » — rendu côté serveur (contenu existant du récap). */
  children: React.ReactNode
}) {
  const [tab, setTab] = useState<Tab>('visite')
  const current = JOURNEY.find((j) => j.key === tab)!

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-4 px-4 pb-24 pt-5">
      {/* On arrive de finir la visite : on clôt la mission par une satisfaction. */}
      {justSaved && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> Visite enregistrée avec succès
          </p>
          <p className="mt-0.5 pl-7 text-[13px] text-emerald-800/80 dark:text-emerald-200/80">
            Votre visite a enrichi la mémoire du chantier.
          </p>
        </div>
      )}

      {/* En-tête chantier — commun à tous les onglets. */}
      <div>
        <Link href={`/m/site/${siteId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Chantier
        </Link>
        <h1 className="mt-2 text-xl font-semibold leading-tight">{siteName}</h1>
        <p className="text-[13px] text-muted-foreground first-letter:uppercase">{visitTypeLabel}</p>
      </div>

      {/* Fil de progression — suggère que les onglets forment un parcours. */}
      <JourneyStepper current={tab} onNavigate={setTab} />

      {/* La QUESTION du chapitre + sa narration (« Voilà… »). */}
      <PanelHeader kicker={current.label} question={current.question} lead={current.lead} />

      {/* Contenu de l'onglet. */}
      <div>
        {tab === 'visite' && children}
        {tab === 'evolution' && <EvolutionPanel p={production} />}
        {tab === 'histoire' && <HistoirePanel timeline={timeline} currentReportId={currentReportId} />}
        {tab === 'memoire' && <MemoirePanel memory={memory} patrimoine={patrimoine} />}
      </div>

      {/* Conclusion — même encart, formule propre à chaque onglet. */}
      <Conclusion Icon={current.conclusion.Icon} text={current.conclusion.text} />

      {/* Barre d'onglets — une main, en bas du pouce. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur safe-bottom">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {JOURNEY.map(({ key, label, Icon }) => {
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

// ── Grammaire commune ─────────────────────────────────────────────────────────

/** Capture → Impact → Historique → Mémoire. Discret, mais on peut y naviguer. */
function JourneyStepper({ current, onNavigate }: { current: Tab; onNavigate: (t: Tab) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] font-medium">
      {JOURNEY.map((j, i) => (
        <Fragment key={j.key}>
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
          <button
            type="button"
            onClick={() => onNavigate(j.key)}
            className={j.key === current ? 'text-emerald-600' : 'text-muted-foreground/60'}
          >
            {j.step}
          </button>
        </Fragment>
      ))}
    </div>
  )
}

function PanelHeader({ kicker, question, lead }: { kicker: string; question: string; lead: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{kicker}</p>
      <h2 className="text-lg font-semibold leading-snug">{question}</h2>
      <p className="text-[13px] leading-snug text-muted-foreground">{lead}</p>
    </div>
  )
}

function Conclusion({ Icon, text }: { Icon: typeof BookOpen; text: string }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <p className="flex items-center gap-2.5 text-sm font-medium text-emerald-900 dark:text-emerald-200">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
          <Icon className="h-[18px] w-[18px] text-emerald-600" />
        </span>
        <span className="min-w-0">{text}</span>
      </p>
    </div>
  )
}

// ── Onglet 2 — Évolution (ce que CETTE visite a apporté au chantier) ──────────
// On raconte une HISTOIRE, pas des compteurs : chaque bloc ne s'affiche que s'il
// porte une information réelle. « Le moteur reste identique, seul le récit change. »

function plural(n: number, one: string, many = `${one}s`): string {
  return n > 1 ? many : one
}

function EvolutionPanel({ p }: { p: VisitProduction | null }) {
  if (!p || p.totalCaptures === 0) {
    return (
      <div className="rounded-2xl border bg-muted/30 p-4">
        <p className="text-sm font-medium">Cette visite a été enregistrée.</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Elle fait désormais partie de l’historique du chantier et pourra être retrouvée lors des prochaines visites et réunions.
        </p>
      </div>
    )
  }

  // Bloc — Nouvelles preuves (médias captés, présence relevée).
  const proofBullets: string[] = []
  if (p.photos > 0) proofBullets.push(`${p.photos} ${plural(p.photos, 'photo')}`)
  if (p.vocals > 0) proofBullets.push(`${p.vocals} ${plural(p.vocals, 'note vocale', 'notes vocales')}`)
  if (p.videos > 0) proofBullets.push(`${p.videos} ${plural(p.videos, 'vidéo')}`)
  if (p.notes > 0) proofBullets.push(`${p.notes} ${plural(p.notes, 'note écrite', 'notes écrites')}`)
  if (p.positions > 0) proofBullets.push(`${p.positions} ${plural(p.positions, 'position GPS', 'positions GPS')}`)

  // Bloc — Nouveaux constats (ce qui interroge / ce qui est vérifié).
  const findingBullets: string[] = []
  if (p.reservesCreated > 0) findingBullets.push(`${p.reservesCreated} ${plural(p.reservesCreated, 'réserve')} ${plural(p.reservesCreated, 'créée')}`)
  if (p.verifications > 0) findingBullets.push(`${p.verifications} ${plural(p.verifications, 'point vérifié', 'points vérifiés')}`)

  // Bloc — Impact sur le chantier (ce qui va faire avancer).
  const impactBullets: string[] = []
  if (p.actionsCreated > 0) impactBullets.push(`${p.actionsCreated} ${plural(p.actionsCreated, 'action ouverte', 'actions ouvertes')}`)

  return (
    <div className="space-y-2.5">
      {proofBullets.length > 0 && (
        <EvoBlock Icon={Camera} cls="text-sky-600" ring="bg-sky-100 dark:bg-sky-950/40" title="Nouvelles preuves" bullets={proofBullets} note="Toutes intégrées au dossier du chantier." />
      )}
      {findingBullets.length > 0 && (
        <EvoBlock Icon={AlertTriangle} cls="text-amber-600" ring="bg-amber-100 dark:bg-amber-950/40" title="Nouveaux constats" bullets={findingBullets} />
      )}
      {impactBullets.length > 0 && (
        <EvoBlock Icon={ListTodo} cls="text-violet-600" ring="bg-violet-100 dark:bg-violet-950/40" title="Impact sur le chantier" bullets={impactBullets} />
      )}
    </div>
  )
}

function EvoBlock({
  Icon, cls, ring, title, bullets, note,
}: {
  Icon: typeof Camera
  cls: string
  ring: string
  title: string
  bullets: string[]
  note?: string
}) {
  return (
    <div className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ring}`}>
          <Icon className={`h-[18px] w-[18px] ${cls}`} />
        </span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <ul className="mt-2 space-y-1 pl-[42px]">
        {bullets.map((b, i) => (
          <li key={i} className="text-[13px] leading-snug text-foreground/90">{b}</li>
        ))}
      </ul>
      {note && <p className="mt-1.5 pl-[42px] text-[12px] italic text-muted-foreground">{note}</p>}
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
  if (timeline.length === 0) {
    return <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">L&apos;histoire du chantier commence avec cette visite.</p>
  }
  return (
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
      {memory.length === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">Pas encore de récurrence détectée — la mémoire se construit visite après visite.</p>
      ) : (
        <ul className="space-y-2">
          {memory.map((s, i) => {
            const Icon = SIGNAL_ICON[s.kind] ?? Brain
            return (
              <li key={i} className="rounded-2xl border bg-background p-3.5 shadow-sm">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted"><Icon className="h-[18px] w-[18px] text-muted-foreground" /></span>
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

      {/* « Ce chantier apprend » — on ne regarde plus une visite, on regarde le
          PATRIMOINE accumulé. Comptes réels, jamais des KPI ni des chiffres inventés. */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
        <p className="flex items-center gap-2.5 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
            <Brain className="h-[18px] w-[18px] text-emerald-600" />
          </span>
          Ce chantier apprend
        </p>
        {patrimoine.firstVisitLabel && (
          <p className="mt-1 pl-[42px] text-[12px] text-emerald-800/70 dark:text-emerald-200/70">Depuis la première visite ({patrimoine.firstVisitLabel})</p>
        )}
        <div className="mt-3 grid grid-cols-3 gap-y-3 gap-x-2 text-center">
          <Stat n={patrimoine.photos} label={patrimoine.photos > 1 ? 'photos' : 'photo'} />
          <Stat n={patrimoine.visits} label={patrimoine.visits > 1 ? 'visites' : 'visite'} />
          <Stat n={patrimoine.meetings} label={patrimoine.meetings > 1 ? 'réunions' : 'réunion'} />
          <Stat n={patrimoine.actions} label={patrimoine.actions > 1 ? 'actions' : 'action'} />
          <Stat n={patrimoine.reserves} label={patrimoine.reserves > 1 ? 'réserves' : 'réserve'} />
          <Stat n={patrimoine.subjects} label={patrimoine.subjects > 1 ? 'sujets suivis' : 'sujet suivi'} />
        </div>
      </div>
    </div>
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
