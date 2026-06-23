import Link from 'next/link'
import { AlertTriangle, FileText, Camera, Info, KeyRound, ClipboardList, CheckCircle2, Construction } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SiteMemoryEvent } from '@/lib/db/site-memory'
import type { SiteMemoryMeta } from '@/lib/db/site-cockpit'
import { salienceOf } from '@/lib/perception/salience'
import { opacityOf, ageDaysSince } from '@/lib/perception/fading'
import {
  gapHeightPx,
  silenceLabel,
  shouldRenderSilenceMarker,
} from '@/lib/perception/gaps'

import { localDateOf, todayLocalIso, addDaysLocal } from '@/lib/time/local-date'
import { FoldableSection } from './FoldableSection'

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  const m = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Pacific/Noumea' })
  return m.charAt(0).toUpperCase() + m.slice(1)
}

const FR_MONTHS_SHORT = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

// Comparaison en dates CIVILES (zone Nouméa), pas en epoch ms. Évite le bug
// où "il y a 38h" est floor à 1 jour et affiché "hier" alors que c'est 2j.
function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const taskIso = localDateOf(d)
  const today = todayLocalIso()
  const yesterday = addDaysLocal(today, -1)
  if (taskIso === today) return "aujourd'hui"
  if (taskIso === yesterday) return 'hier'
  const [y, m, dd] = taskIso.split('-').map(Number)
  const todayYear = Number(today.slice(0, 4))
  const yearSuffix = y !== todayYear ? ` ${y}` : ''
  return `${dd} ${FR_MONTHS_SHORT[m - 1]}${yearSuffix}`
}

/**
 * V5.1.4 — Mémoire du lieu / TraceStream, style cohérent shadcn.
 *
 * Garde la sémantique stratifiée (opacity fading, gaps proportionnels au
 * silence, cicatrice persistante pour anomalies) — c'est doctrinal, pas
 * stylistique. Mais visuellement aligné avec le reste de l'app (text-sm,
 * text-muted-foreground, icônes Lucide, palette sémantique).
 */

const TYPE_ICON: Record<SiteMemoryEvent['type'], LucideIcon> = {
  intervention: FileText,
  photo: Camera,
  anomaly: AlertTriangle,
  note: Info,
  a_savoir: Info,
  access: KeyRound,
  report: ClipboardList,
  action: CheckCircle2,
  blocage: Construction,
}

const TYPE_ICON_COLOR: Record<SiteMemoryEvent['type'], string> = {
  intervention: 'text-muted-foreground',
  photo: 'text-sky-600',
  anomaly: 'text-amber-600',
  note: 'text-muted-foreground',
  a_savoir: 'text-muted-foreground',
  // Incident d'accès → amber (saillant) ; routine → neutre. Géré via meta.
  access: 'text-muted-foreground',
  report: 'text-indigo-600',
  action: 'text-emerald-600',
  // Rouge : blocage = quelque chose empêche d'avancer, saillant.
  blocage: 'text-rose-600',
}

// Vincent 2026-05-21 — badge texte explicite pour que l'utilisateur sache
// IMMÉDIATEMENT de quoi est faite chaque ligne (anomalie ? note ? passage ?
// résonance ?). C'est SAISI PAR DES HUMAINS, pas généré par l'IA.
const TYPE_BADGE_LABEL: Record<SiteMemoryEvent['type'], string> = {
  intervention: 'Note d’intervention',
  photo: 'Photo',
  anomaly: 'Signalement',
  note: 'Note de site',
  a_savoir: 'À savoir',
  access: 'Accès',
  report: 'Compte-rendu',
  action: 'Action clôturée',
  blocage: 'Blocage',
}

// Palette distincte par type — chaque famille de couleur est franchement
// différente pour éviter la confusion à l'œil rapide.
const TYPE_BADGE_CLASS: Record<SiteMemoryEvent['type'], string> = {
  // Bleu : note d'intervention = saisie quotidienne sur prestation
  intervention: 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800',
  // Cyan : photo = trace visuelle, lié au site
  photo: 'bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-200 dark:border-cyan-800',
  // Orange : signalement = anomalie déclarée, saillant
  anomaly: 'bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-800',
  // Violet : note de site = écrit hors intervention, plus contextuel
  note: 'bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-800',
  // Rose : À savoir = consigne persistante, statique
  a_savoir: 'bg-pink-100 text-pink-900 border-pink-300 dark:bg-pink-950/40 dark:text-pink-200 dark:border-pink-800',
  // Vert : accès = preuve d'accès site (passage)
  access: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800',
  // Indigo : compte-rendu = artefact source multimodal
  report: 'bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800',
  // Vert émeraude : action clôturée = fait accompli (mémoire du chantier)
  action: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800',
  // Rouge : blocage = un fait qui a empêché d'avancer (mémoire de contexte)
  blocage: 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800',
}

function badgeLabelFor(event: SiteMemoryEvent): string {
  // Cas spéciaux selon meta
  if (event.type === 'anomaly' && event.meta?.grouped === true) {
    return 'Signalements groupés'
  }
  if (event.type === 'access' && event.meta?.kind === 'incident') {
    return 'Incident d’accès'
  }
  if (event.type === 'blocage') {
    return event.meta?.ongoing === true ? 'Blocage en cours' : 'Blocage levé'
  }
  return TYPE_BADGE_LABEL[event.type]
}

interface Props {
  events: SiteMemoryEvent[]
  meta?: SiteMemoryMeta
}

export function TraceStream({ events, meta }: Props) {
  if (events.length === 0) {
    if (meta && (meta.executedInterventions > 0 || meta.photoCount > 0)) {
      const parts: string[] = []
      if (meta.executedInterventions > 0)
        parts.push(`${meta.executedInterventions} passage${meta.executedInterventions > 1 ? 's' : ''}`)
      if (meta.tasksCompleted > 0)
        parts.push(`${meta.tasksCompleted} tâche${meta.tasksCompleted > 1 ? 's' : ''} réalisée${meta.tasksCompleted > 1 ? 's' : ''}`)
      if (meta.photoCount > 0)
        parts.push(`${meta.photoCount} photo${meta.photoCount > 1 ? 's' : ''}`)
      const since = meta.firstTraceAt ? ` depuis ${formatMonthYear(meta.firstTraceAt).toLowerCase()}` : ''
      const lastTask = meta.lastTaskCompletedAt ? ` — dernière tâche le ${formatShortDate(meta.lastTaskCompletedAt)}` : ''
      return (
        <p className="text-sm text-muted-foreground">
          {parts.join(' · ')}{since}{lastTask}.
        </p>
      )
    }
    return (
      <p className="text-sm text-muted-foreground italic">
        Le lieu commence à se documenter.
      </p>
    )
  }

  const now = new Date()

  // Summary header
  const summaryParts: string[] = []
  if (meta) {
    if (meta.executedInterventions > 0)
      summaryParts.push(`${meta.executedInterventions} passage${meta.executedInterventions > 1 ? 's' : ''}`)
    if (meta.tasksCompleted > 0)
      summaryParts.push(`${meta.tasksCompleted} tâche${meta.tasksCompleted > 1 ? 's' : ''} réalisée${meta.tasksCompleted > 1 ? 's' : ''}`)
    if (meta.photoCount > 0)
      summaryParts.push(`${meta.photoCount} photo${meta.photoCount > 1 ? 's' : ''}`)
  }

  // Vincent 2026-05-21 — types présents dans le flux, pour la légende compacte.
  const typesPresent = new Set<SiteMemoryEvent['type']>(events.map((e) => e.type))
  const LEGEND_ORDER: SiteMemoryEvent['type'][] = ['intervention', 'anomaly', 'note', 'a_savoir', 'photo', 'access']
  // Vincent 2026-05-21 (Option A) : badge synthétique pour les prestations
  // récurrentes du bloc taskHistory. Couleur émeraude (cohérence : déjà
  // utilisée comme dot d'item exécuté). Distincte des 6 types d'events.
  const TASK_BADGE_CLASS = 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800'

  return (
    <div className="space-y-3">
      {summaryParts.length > 0 && (
        <p className="text-xs text-muted-foreground">{summaryParts.join(' · ')}</p>
      )}

      {/* Légende des badges — explique l'origine de chaque ligne.
          Vincent 2026-05-21 : on ne sait pas si c'est une anomalie / note /
          passage / résonance. La légende lève toute ambiguïté. */}
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wide">Légende :</span>
        {meta && meta.taskHistory.length > 0 && (
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium uppercase tracking-wide ${TASK_BADGE_CLASS}`}
          >
            Prestation
          </span>
        )}
        {LEGEND_ORDER.filter((t) => typesPresent.has(t)).map((t) => (
          <span
            key={t}
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium uppercase tracking-wide ${TYPE_BADGE_CLASS[t]}`}
          >
            {TYPE_BADGE_LABEL[t]}
          </span>
        ))}
      </div>

      {/* ── Prestations récurrentes (taskHistory) ──────────────────────── */}
      {meta && meta.taskHistory.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Prestations récurrentes
          </h3>
          <ul className="space-y-0.5">
            {meta.taskHistory.map((t) => (
              <li key={t.label} className="flex items-baseline gap-1.5 py-px">
                <span
                  className={`shrink-0 inline-flex items-center rounded border px-1 py-0 text-[9px] font-semibold uppercase tracking-tight leading-snug ${TASK_BADGE_CLASS}`}
                  title="Prestation récurrente (item de checklist exécuté)"
                >
                  Prestation
                </span>
                <span className="text-xs leading-snug min-w-0 flex-1 truncate">{t.label}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {t.count > 1 && <span className="mr-1.5 text-muted-foreground/60">×{t.count}</span>}
                  {formatShortDate(t.lastDoneAt)}
                </span>
            </li>
          ))}
          </ul>
        </div>
      )}

      {/* ── Événements (flux narratif) ─────────────────────────────────── */}
      <FoldableSection
        title="Événements"
        titleClassName="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        className="space-y-1"
        bodyClassName="mt-1"
      >
        <ol className="space-y-0">
        {events.map((event, idx) => {
        const ageDays = ageDaysSince(event.occurredAt, now)
        const salience = salienceOf(event)
        const opacity = opacityOf(salience, ageDays)

        const prev = events[idx - 1]
        const daysBetween = prev
          ? Math.max(
              0,
              Math.floor(
                (new Date(prev.occurredAt).getTime() -
                  new Date(event.occurredAt).getTime()) /
                  86_400_000,
              ),
            )
          : 0
        // Vincent 2026-05-21 — gaps quasi-supprimés : seuls les silences
        // > 14 jours dessinent un mini-marqueur. Le reste = densité max.
        const gapPx = idx === 0 ? 0 : daysBetween > 14 ? 16 : 0
        const showSilence = idx > 0 && shouldRenderSilenceMarker(daysBetween)
        const silenceText = showSilence ? silenceLabel(daysBetween) : null

        return (
          <li key={`${event.type}-${event.id}`}>
            {idx > 0 && (
              <div
                aria-hidden
                style={{ height: gapPx }}
                className="relative flex items-center justify-center"
              >
                {silenceText && (
                  <span className="text-xs italic text-muted-foreground/60 select-none">
                    {silenceText}
                  </span>
                )}
              </div>
            )}
            <TraceLine event={event} opacity={opacity} ageDays={ageDays} />
          </li>
        )
      })}
        </ol>
      </FoldableSection>
    </div>
  )
}

interface TraceLineProps {
  event: SiteMemoryEvent
  opacity: number
  ageDays: number
}

function TraceLine({ event, opacity, ageDays }: TraceLineProps) {
  // Bordure gauche cicatrice anomalie — doctrinal, persistante même après
  // résolution. Conservée mais en palette sémantique amber/muted.
  let borderClass = ''
  if (event.type === 'anomaly') {
    const status = event.status ?? 'open'
    if (status === 'open') {
      borderClass = ageDays < 14 ? 'border-l-2 border-amber-500' : 'border-l-2 border-amber-300'
    } else if (status === 'resolved') {
      borderClass = ageDays < 90 ? 'border-l-2 border-muted-foreground/40' : 'border-l border-muted-foreground/20'
    } else {
      borderClass = 'border-l border-muted-foreground/10'
    }
  }

  const dateLabel = formatDateLabel(event.occurredAt, ageDays)
  const Icon = TYPE_ICON[event.type]
  const iconColor = TYPE_ICON_COLOR[event.type]

  // Vincent 2026-05-21 — densité quasi maximale (style taskHistory, cf. plus haut).
  // Une seule ligne par event : badge + icône inline + titre + date à droite.
  const inner = (
    <div
      className={`flex items-baseline gap-1.5 py-px px-1 ${borderClass}`}
      style={{ opacity, paddingLeft: borderClass ? 8 : 4 }}
    >
      <Icon className={`h-2.5 w-2.5 shrink-0 ${iconColor}`} aria-hidden />
      <span
        className={`shrink-0 inline-flex items-center rounded border px-1 py-0 text-[9px] font-semibold uppercase tracking-tight leading-snug ${TYPE_BADGE_CLASS[event.type]}`}
        title={`Source : ${badgeLabelFor(event).toLowerCase()}`}
      >
        {badgeLabelFor(event)}
      </span>
      <span className="text-xs leading-snug min-w-0 flex-1 truncate">
        {event.title}
        {event.detail && (
          <span className="text-muted-foreground/70 ml-1.5">· {event.detail}</span>
        )}
      </span>
      {event.type === 'action' && typeof event.meta?.photoUrl === 'string' && (
        <Camera className="h-2.5 w-2.5 shrink-0 text-emerald-600" aria-label="Photo de clôture jointe" />
      )}
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {dateLabel}
      </span>
    </div>
  )

  const href = event.interventionId
    ? `/interventions/${event.interventionId}`
    : event.type === 'action' && typeof event.meta?.reportId === 'string'
      ? `/meetings/${event.meta.reportId}`
      : null
  if (href) {
    return (
      <Link href={href} className="block hover:bg-muted/30 rounded transition-colors">
        {inner}
      </Link>
    )
  }
  return inner
}

function formatDateLabel(iso: string, ageDays: number): string {
  const d = new Date(iso)
  if (ageDays === 0) return "aujourd'hui"
  if (ageDays === 1) return 'hier'
  if (ageDays < 7) {
    return d.toLocaleDateString('fr-FR', { weekday: 'long' })
  }
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
