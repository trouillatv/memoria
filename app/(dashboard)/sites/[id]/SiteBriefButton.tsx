'use client'

// « Préparer ma visite » — bouton + panneau de briefing « À savoir avant d'y aller ».
//
// V1 (2026-06-16) : ouvre un panneau auto-suffisant qui agrège la mémoire déjà
// captée du LIEU (actions, anomalies, à savoir, résonances, équipes, missions,
// preuves, réunions). Lecture en 30s avant de partir sur site. Mobile-first.
//
// Doctrine : descriptif et calme. Les humains (équipes) n'apparaissent que comme
// contexte, jamais avec un score. Aucun appel LLM — pure agrégation côté serveur.

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Brain,
  X,
  Loader2,
  ListTodo,
  CheckCircle2,
  AlertTriangle,
  Info,
  Repeat,
  Users,
  Hammer,
  Camera,
  MessagesSquare,
  CalendarClock,
  BellRing,
  Flag,
  History,
  Check,
} from 'lucide-react'
import { getSiteBriefAction, type SiteBrief } from './site-brief-actions'

interface Props {
  siteId: string
  variant?: 'mobile' | 'desktop'
  /** 'visit' = avant d'aller sur site · 'meeting' = avant une réunion chantier. */
  mode?: 'visit' | 'meeting'
}

const MODE_META = {
  visit:   { label: 'Préparer ma visite',  panel: "À savoir avant d'y aller", Icon: Brain },
  meeting: { label: 'Préparer ma réunion', panel: 'À aborder en réunion',     Icon: MessagesSquare },
} as const

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function ageDaysLabel(iso: string | null): string | null {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (Number.isNaN(days) || days < 0) return null
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  return `il y a ${days} j`
}

export function SiteBriefButton({ siteId, variant = 'desktop', mode = 'visit' }: Props) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState<SiteBrief | null>(null)
  const [pending, startTransition] = useTransition()
  const meta = MODE_META[mode]
  const MetaIcon = meta.Icon

  function load() {
    setOpen(true)
    if (brief) return // déjà chargé pour ce site
    startTransition(async () => {
      const r = await getSiteBriefAction(siteId)
      if (r.ok) {
        setBrief(r.brief)
      } else {
        toast.error(r.error)
        setOpen(false)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={load}
        className={
          variant === 'mobile'
            ? 'w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3.5 text-base font-semibold text-background active:scale-[0.99] transition-transform'
            : 'inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 transition-[transform,opacity] active:scale-[0.97]'
        }
      >
        <MetaIcon className={variant === 'mobile' ? 'h-5 w-5' : 'h-4 w-4'} />
        {meta.label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/40 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={meta.panel}
          >
            {/* En-tête collant */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-card px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight inline-flex items-center gap-2">
                  <MetaIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  {meta.panel}
                </h2>
                {brief && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {brief.siteName}
                    {brief.contractName ? ` · ${brief.contractName}` : ''}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-5">
              {pending && !brief && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Préparation du brief…
                </div>
              )}

              {brief && <BriefBody brief={brief} mode={mode} />}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SectionTitle({
  icon,
  children,
  count,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  count?: number
}) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
      {icon}
      {children}
      {typeof count === 'number' && count > 0 && (
        <span className="font-normal normal-case">({count})</span>
      )}
    </h3>
  )
}

// Ordre des sections par mode. En réunion, Réserves + Dernier CR remontent tout
// en haut (les 2 blocs critiques pour parler aux gens).
const VISIT_ORDER = ['vigilance', 'aSavoir', 'anomalies', 'reserves', 'actions', 'recentDone', 'recurring', 'missions', 'teams', 'meetings', 'photos'] as const
const MEETING_ORDER = ['vigilance', 'reserves', 'actions', 'anomalies', 'missions', 'teams', 'photos', 'aSavoir', 'recurring', 'meetings', 'recentDone'] as const

function BriefBody({ brief, mode }: { brief: SiteBrief; mode: 'visit' | 'meeting' }) {
  const {
    situation,
    vigilance,
    openActions,
    recentDoneActions,
    anomaliesOpen,
    aSavoir,
    recurring,
    teams,
    missionNames,
    recentPhotosCount,
    meetings,
    openReserves,
    lastReport,
    changeSinceLastReport,
  } = brief

  const nextLabel = formatDate(situation.nextScheduledAt)

  const hasAnyDetail =
    changeSinceLastReport != null ||
    vigilance.length > 0 ||
    openReserves.length > 0 ||
    (lastReport?.actionTitles.length ?? 0) > 0 ||
    openActions.length > 0 ||
    recentDoneActions.length > 0 ||
    anomaliesOpen.length > 0 ||
    aSavoir.length > 0 ||
    recurring.length > 0 ||
    teams.length > 0 ||
    missionNames.length > 0 ||
    recentPhotosCount > 0 ||
    meetings.length > 0

  const sections: Record<string, React.ReactNode> = {
    vigilance: vigilance.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<BellRing className="h-3.5 w-3.5 text-rose-600" />} count={vigilance.length}>
          À ne pas oublier
        </SectionTitle>
        <ul className="space-y-1.5">
          {vigilance.map((v) => (
            <li key={v.id} className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2">
              <span className="text-sm min-w-0 text-rose-950">{v.title}</span>
              <span className="shrink-0 text-[11px] font-medium whitespace-nowrap text-rose-700">
                {v.overdue ? 'en retard' : `depuis ${v.ageDays} j`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ),
    reserves: openReserves.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Flag className="h-3.5 w-3.5 text-rose-600" />} count={openReserves.length}>
          Réserves non levées
        </SectionTitle>
        <ul className="space-y-1.5">
          {openReserves.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
              <span className="text-sm min-w-0">
                {r.label}
                {r.location && <span className="text-muted-foreground"> · {r.location}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">depuis {r.ageDays} j</span>
            </li>
          ))}
        </ul>
      </section>
    ),
    actions: openActions.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<ListTodo className="h-3.5 w-3.5" />} count={situation.openActions}>
          Actions à suivre
        </SectionTitle>
        <ul className="space-y-1.5">
          {openActions.map((a) => {
            const due = formatDate(a.dueDate)
            const age = ageDaysLabel(a.createdAt)
            return (
              <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                <span className="text-sm min-w-0">{a.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                  {due ? `échéance ${due}` : age ?? ''}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    ),
    anomalies: anomaliesOpen.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<AlertTriangle className="h-3.5 w-3.5" />} count={anomaliesOpen.length}>
          Anomalies ouvertes
        </SectionTitle>
        <ul className="space-y-1.5">
          {anomaliesOpen.map((a) => (
            <li key={a.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900">
              {a.description}
            </li>
          ))}
        </ul>
      </section>
    ),
    aSavoir: aSavoir.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Info className="h-3.5 w-3.5" />} count={aSavoir.length}>À savoir</SectionTitle>
        <ul className="space-y-1.5">
          {aSavoir.map((n) => (
            <li key={n.id} className="flex gap-1.5 text-sm text-amber-900">
              <span aria-hidden className="text-amber-600">⚠</span>
              <span className="min-w-0">{n.body}</span>
            </li>
          ))}
        </ul>
      </section>
    ),
    recurring: recurring.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Repeat className="h-3.5 w-3.5" />}>Ce qui revient ici</SectionTitle>
        <ul className="space-y-1.5">
          {recurring.map((r, i) => (
            <li key={i} className="text-sm text-muted-foreground italic leading-relaxed">{r.text}</li>
          ))}
        </ul>
      </section>
    ),
    missions: missionNames.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Hammer className="h-3.5 w-3.5" />}>Missions sur le site</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {missionNames.map((name) => (
            <span key={name} className="inline-flex items-center rounded-full border bg-card px-2.5 py-0.5 text-xs">{name}</span>
          ))}
        </div>
      </section>
    ),
    teams: teams.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<Users className="h-3.5 w-3.5" />}>Équipes qui connaissent le site</SectionTitle>
        <ul className="space-y-1">
          {teams.map((t) => (
            <li key={t.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{t.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                {t.passages} passage{t.passages > 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ),
    recentDone: recentDoneActions.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Récemment fait</SectionTitle>
        <ul className="space-y-1.5">
          {recentDoneActions.map((a) => {
            const when = ageDaysLabel(a.doneAt)
            return (
              <li key={a.id} className="flex items-start justify-between gap-3 text-sm text-muted-foreground">
                <span className="min-w-0 inline-flex gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="min-w-0">{a.title}</span>
                </span>
                {when && <span className="shrink-0 text-[11px] whitespace-nowrap">{when}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    ),
    meetings: meetings.length === 0 ? null : (
      <section className="space-y-2">
        <SectionTitle icon={<MessagesSquare className="h-3.5 w-3.5" />}>Réunions récentes</SectionTitle>
        <ul className="space-y-1">
          {meetings.map((m) => {
            const when = formatDate(m.createdAt)
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span className="min-w-0 truncate">{m.title ?? 'Compte-rendu'}</span>
                {when && <span className="shrink-0 text-[11px] whitespace-nowrap">{when}</span>}
              </li>
            )
          })}
        </ul>
      </section>
    ),
    photos: recentPhotosCount === 0 ? null : (
      <section>
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5" />
          {recentPhotosCount} preuve{recentPhotosCount > 1 ? 's' : ''} photo récente{recentPhotosCount > 1 ? 's' : ''}
        </p>
      </section>
    ),
  }

  const order = mode === 'meeting' ? MEETING_ORDER : VISIT_ORDER

  return (
    <div className="space-y-5">
      {/* V2a — Ce qui a changé depuis la dernière réunion (déterministe, zéro LLM) */}
      {changeSinceLastReport && (
        <section className="space-y-2.5 rounded-xl border bg-muted/30 p-3">
          <SectionTitle icon={<History className="h-3.5 w-3.5" />}>
            Depuis la dernière réunion
            {formatDate(changeSinceLastReport.sinceDate) ? ` · ${formatDate(changeSinceLastReport.sinceDate)}` : ''}
          </SectionTitle>
          {lastReport && lastReport.actionTitles.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Décidé alors</p>
              <ul className="space-y-0.5">
                {lastReport.actionTitles.map((t, i) => (
                  <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                    <span aria-hidden className="text-muted-foreground/50">›</span>
                    <span className="min-w-0">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {changeSinceLastReport.resolved.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Résolu</p>
              <ul className="space-y-0.5">
                {changeSinceLastReport.resolved.map((t, i) => (
                  <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span className="min-w-0">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {changeSinceLastReport.stillOpen.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Toujours ouvert</p>
              <ul className="space-y-0.5">
                {changeSinceLastReport.stillOpen.map((t, i) => (
                  <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span className="min-w-0">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {changeSinceLastReport.newItems.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Nouveaux</p>
              <ul className="space-y-0.5">
                {changeSinceLastReport.newItems.map((t, i) => (
                  <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                    <BellRing className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />
                    <span className="min-w-0">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Situation — chips de synthèse (toujours en tête) */}
      <section className="space-y-2">
        <SectionTitle icon={<Info className="h-3.5 w-3.5" />}>En un coup d&apos;œil</SectionTitle>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2.5 py-1 font-medium">
            <ListTodo className="h-3.5 w-3.5" />
            {situation.openActions} action{situation.openActions > 1 ? 's' : ''} ouverte{situation.openActions > 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2.5 py-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            {situation.openAnomalies} anomalie{situation.openAnomalies > 1 ? 's' : ''}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
            <Hammer className="h-3.5 w-3.5" />
            {situation.passagesThisMonth} passage{situation.passagesThisMonth > 1 ? 's' : ''} ce mois
          </span>
          {nextLabel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium">
              <CalendarClock className="h-3.5 w-3.5" />
              Prochain : {nextLabel}
            </span>
          )}
        </div>
      </section>

      {order.map((k) => (sections[k] ? <div key={k}>{sections[k]}</div> : null))}

      {!hasAnyDetail && (
        <p className="text-sm text-muted-foreground italic py-4 text-center">
          Pas encore de mémoire notable sur ce site. Les premières traces apparaîtront ici.
        </p>
      )}
    </div>
  )
}
