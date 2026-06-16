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
} from 'lucide-react'
import { getSiteBriefAction, type SiteBrief } from './site-brief-actions'

interface Props {
  siteId: string
  variant?: 'mobile' | 'desktop'
}

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

export function SiteBriefButton({ siteId, variant = 'desktop' }: Props) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState<SiteBrief | null>(null)
  const [pending, startTransition] = useTransition()

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
        <Brain className={variant === 'mobile' ? 'h-5 w-5' : 'h-4 w-4'} />
        Préparer ma visite
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
            aria-label="À savoir avant d'y aller"
          >
            {/* En-tête collant */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-card px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight inline-flex items-center gap-2">
                  <Brain className="h-4 w-4 text-muted-foreground shrink-0" />
                  À savoir avant d&apos;y aller
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

              {brief && <BriefBody brief={brief} />}
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

function BriefBody({ brief }: { brief: SiteBrief }) {
  const {
    situation,
    openActions,
    recentDoneActions,
    anomaliesOpen,
    aSavoir,
    recurring,
    teams,
    missionNames,
    recentPhotosCount,
    meetings,
  } = brief

  const nextLabel = formatDate(situation.nextScheduledAt)

  const hasAnyDetail =
    openActions.length > 0 ||
    recentDoneActions.length > 0 ||
    anomaliesOpen.length > 0 ||
    aSavoir.length > 0 ||
    recurring.length > 0 ||
    teams.length > 0 ||
    missionNames.length > 0 ||
    recentPhotosCount > 0 ||
    meetings.length > 0

  return (
    <div className="space-y-5">
      {/* Situation — chips de synthèse */}
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

      {/* À savoir — vigilances persistantes */}
      {aSavoir.length > 0 && (
        <section className="space-y-2">
          <SectionTitle icon={<Info className="h-3.5 w-3.5" />} count={aSavoir.length}>
            À savoir
          </SectionTitle>
          <ul className="space-y-1.5">
            {aSavoir.map((n) => (
              <li key={n.id} className="flex gap-1.5 text-sm text-amber-900">
                <span aria-hidden className="text-amber-600">⚠</span>
                <span className="min-w-0">{n.body}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Anomalies ouvertes */}
      {anomaliesOpen.length > 0 && (
        <section className="space-y-2">
          <SectionTitle icon={<AlertTriangle className="h-3.5 w-3.5" />} count={anomaliesOpen.length}>
            Anomalies ouvertes
          </SectionTitle>
          <ul className="space-y-1.5">
            {anomaliesOpen.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-900"
              >
                {a.description}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Actions ouvertes */}
      {openActions.length > 0 && (
        <section className="space-y-2">
          <SectionTitle icon={<ListTodo className="h-3.5 w-3.5" />} count={situation.openActions}>
            Actions à suivre
          </SectionTitle>
          <ul className="space-y-1.5">
            {openActions.map((a) => {
              const due = formatDate(a.dueDate)
              const age = ageDaysLabel(a.createdAt)
              return (
                <li
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2"
                >
                  <span className="text-sm min-w-0">{a.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                    {due ? `échéance ${due}` : age ?? ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Récemment fait */}
      {recentDoneActions.length > 0 && (
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
      )}

      {/* Ce qui revient — résonances / lectures du lieu */}
      {recurring.length > 0 && (
        <section className="space-y-2">
          <SectionTitle icon={<Repeat className="h-3.5 w-3.5" />}>Ce qui revient ici</SectionTitle>
          <ul className="space-y-1.5">
            {recurring.map((r, i) => (
              <li key={i} className="text-sm text-muted-foreground italic leading-relaxed">
                {r.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Missions / contrat */}
      {missionNames.length > 0 && (
        <section className="space-y-2">
          <SectionTitle icon={<Hammer className="h-3.5 w-3.5" />}>Missions sur le site</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {missionNames.map((name) => (
              <span key={name} className="inline-flex items-center rounded-full border bg-card px-2.5 py-0.5 text-xs">
                {name}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Équipes qui connaissent le site — descriptif, jamais classé */}
      {teams.length > 0 && (
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
      )}

      {/* Réunions récentes */}
      {meetings.length > 0 && (
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
      )}

      {/* Preuves récentes */}
      {recentPhotosCount > 0 && (
        <section>
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5" />
            {recentPhotosCount} preuve{recentPhotosCount > 1 ? 's' : ''} photo récente{recentPhotosCount > 1 ? 's' : ''}
          </p>
        </section>
      )}

      {!hasAnyDetail && (
        <p className="text-sm text-muted-foreground italic py-4 text-center">
          Pas encore de mémoire notable sur ce site. Les premières traces apparaîtront ici.
        </p>
      )}
    </div>
  )
}
