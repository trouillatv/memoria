'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Brain, BookOpen, CheckCircle2, ChevronRight } from 'lucide-react'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { computeAttentionSignals, formatAttentionFragments } from '@/lib/subjects/attention'
import { cn } from '@/lib/utils'

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = 'surveiller' | 'mouvement' | 'attente' | 'tout'

const TABS: { id: Tab; label: string }[] = [
  { id: 'surveiller', label: 'À surveiller' },
  { id: 'mouvement',  label: 'En mouvement' },
  { id: 'attente',    label: 'En attente' },
  { id: 'tout',       label: 'Tout' },
]

// ── Display constants ─────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  open:               'Ouvert',
  in_progress:        'En cours',
  planned:            'Planifié',
  done:               'Clôturé',
  non_compliant:      'Non conforme',
  awaiting_validation:'En attente',
  cancelled:          'Annulé',
  informational:      'Informatif',
  field_checked:      'Vérifié terrain',
  still_open:         'Toujours ouvert',
  not_applicable:     'Sans objet',
  mentioned:          'Évoqué',
}

const STATUS_COLORS: Record<string, string> = {
  done:               'bg-emerald-100 text-emerald-800',
  non_compliant:      'bg-red-100 text-red-700',
  open:               'bg-orange-100 text-orange-700',
  in_progress:        'bg-blue-100 text-blue-700',
  planned:            'bg-sky-100 text-sky-700',
  awaiting_validation:'bg-amber-100 text-amber-700',
  cancelled:          'bg-muted text-muted-foreground',
  informational:      'bg-muted text-muted-foreground',
  field_checked:      'bg-teal-100 text-teal-700',
  still_open:         'bg-orange-100 text-orange-700',
  not_applicable:     'bg-muted text-muted-foreground',
  mentioned:          'bg-violet-100 text-violet-700',
}

// ── Bucketing ─────────────────────────────────────────────────────────────────

const CLOSED_STATUSES = new Set(['done', 'cancelled', 'not_applicable'])
const SIXTY_DAYS_MS   = 60 * 86_400_000

type Bucket = 'watch' | 'moving' | 'open' | 'knowledge' | 'closed'

function getBucket(s: NavigableSubjectSummary, nowMs: number): Bucket {
  const signals = computeAttentionSignals(s)
  // Vetos absolus — jamais court-circuités par un signal.
  if (signals.isClosed)       return 'closed'
  if (!signals.isOperational) return 'knowledge'
  // Au moins un signal d'attention → À surveiller.
  if (signals.attentionReasons.length > 0) return 'watch'
  const recentChange = s.lastMeaningfulChangeAt &&
    new Date(s.lastMeaningfulChangeAt).getTime() > nowMs - SIXTY_DAYS_MS
  return recentChange ? 'moving' : 'open'
}

// ── Radar premier PV ─────────────────────────────────────────────────────────

function youngSiteRadarPriority(s: NavigableSubjectSummary): number {
  // #228 : éligibilité opérationnelle = nature durable (actor exclu). L'ordre fin reste sur la famille.
  if (s.durableKind === 'actor')                        return 99
  if (CLOSED_STATUSES.has(s.currentStatus ?? ''))       return 99
  if (s.activeObjects.total > 0)                        return 0
  if (s.currentStatus === 'non_compliant')              return 1
  if (s.dominantFamily === 'reservation')               return 2
  if (s.currentStatus === 'awaiting_validation')        return 3
  if (s.dominantFamily === 'decision')                  return 4
  if (s.dominantFamily === 'deadline')                  return 5
  if (s.currentStatus === 'in_progress')                return 6
  if (s.dominantFamily === 'action')                    return 7
  if (s.currentStatus === 'open')                       return 8
  if (s.currentStatus === 'planned')                    return 9
  if (s.dominantFamily === 'observation')               return 10
  if (s.currentStatus === 'mentioned')                  return 11
  return 99
}

// ── Kind grouping (vue "Tout") ─────────────────────────────────────────────────

type KindGroup = 'operational' | 'knowledge' | 'deadline' | 'actor'

function getKindGroup(s: NavigableSubjectSummary): KindGroup {
  // #228 : acteur = nature durable ; deadline/knowledge = famille descriptive de la 1re occurrence.
  if (s.durableKind === 'actor')          return 'actor'
  if (s.dominantFamily === 'deadline')    return 'deadline'
  if (s.dominantFamily === 'knowledge_fact') return 'knowledge'
  return 'operational'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{count}</span>
    </div>
  )
}

function SubjectCard({ subject, siteId, bucket }: {
  subject: NavigableSubjectSummary
  siteId: string
  bucket: Bucket
}) {
  const { canonicalSubjectId, title, currentStatus, pvCount, nativeOccurrenceCount,
    isStagnant, stagnationDays, lastMeaningfulChangeAt, activeObjects } = subject

  const statusLabel = currentStatus ? (STATUS_LABELS[currentStatus] ?? currentStatus) : null
  const statusColor = currentStatus ? (STATUS_COLORS[currentStatus] ?? 'bg-muted text-muted-foreground') : null

  const sourceFragments: string[] = []
  if (pvCount > 0) sourceFragments.push(`${pvCount} PV`)
  if (nativeOccurrenceCount > 0) sourceFragments.push('terrain')
  const sourceLine = sourceFragments.join(' · ')

  const isWatch    = bucket === 'watch'
  const isKnowledge = bucket === 'knowledge'
  const isClosed    = bucket === 'closed'

  // Raisons d'attention — calculées uniquement pour les cartes dans "À surveiller"
  const attentionSignals = isWatch ? computeAttentionSignals(subject) : null
  const attentionFragments = attentionSignals
    ? formatAttentionFragments(subject, attentionSignals.attentionReasons)
    : []

  return (
    <Link
      href={`/m/site/${siteId}/sujets/${canonicalSubjectId}`}
      className={cn(
        'flex items-start gap-3 rounded-2xl border bg-card px-3.5 py-3 shadow-sm active:brightness-95',
        isWatch && isStagnant && 'border-amber-200',
        isClosed   && 'opacity-60',
      )}
    >
      <span className={cn(
        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        isWatch && isStagnant ? 'bg-amber-50' :
        isKnowledge           ? 'bg-muted' :
        isClosed              ? 'bg-muted' :
                                'bg-indigo-50 dark:bg-indigo-950/40',
      )}>
        {isWatch && isStagnant
          ? <AlertCircle className="h-4 w-4 text-amber-600" />
          : isKnowledge
            ? <BookOpen className="h-4 w-4 text-muted-foreground" />
            : isClosed
              ? <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              : <Brain className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-snug">{title}</span>

        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {statusLabel && statusColor && (
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', statusColor)}>
              {statusLabel}
            </span>
          )}
          {sourceLine && (
            <span className="text-[11px] text-muted-foreground">{sourceLine}</span>
          )}
        </span>

        {/* Ligne d'attention — remplace les lignes séparées stagnation / dernier changement pour les cartes dans watch */}
        {isWatch && attentionFragments.length > 0 && (
          <span className={cn(
            'mt-1 block text-[11px]',
            isStagnant ? 'text-amber-700' : 'text-indigo-700 dark:text-indigo-400',
          )}>
            {attentionFragments.join(' · ')}
          </span>
        )}

        {/* Hors watch : comportement existant */}
        {!isWatch && isStagnant && stagnationDays > 0 && (
          <span className="mt-1 block text-[11px] text-amber-700">
            Sans évolution depuis {stagnationDays} jour{stagnationDays > 1 ? 's' : ''}
          </span>
        )}
        {!isWatch && !isClosed && lastMeaningfulChangeAt && (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Évolué le {new Date(lastMeaningfulChangeAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
          </span>
        )}
        {!isWatch && activeObjects.total > 0 && (
          <span className="mt-0.5 block text-[11px] font-medium text-indigo-700 dark:text-indigo-400">
            {activeObjects.total} objet{activeObjects.total > 1 ? 's' : ''} actif{activeObjects.total > 1 ? 's' : ''}
            {activeObjects.actionsOpen > 0 && activeObjects.total > 1 &&
              ` · ${activeObjects.actionsOpen} action${activeObjects.actionsOpen > 1 ? 's' : ''}`}
          </span>
        )}
      </span>

      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function SubjectSection({ subjects, siteId, label, bucketFor }: {
  subjects: NavigableSubjectSummary[]
  siteId: string
  label: string
  bucketFor: (s: NavigableSubjectSummary) => Bucket
}) {
  if (subjects.length === 0) return null
  return (
    <section className="space-y-1.5">
      <SectionHeader label={label} count={subjects.length} />
      <ul className="space-y-1.5">
        {subjects.map((s) => (
          <li key={s.canonicalSubjectId}>
            <SubjectCard subject={s} siteId={siteId} bucket={bucketFor(s)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function EmptyTab({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-8 text-center">
      <p className="text-[13px] text-muted-foreground">{message}</p>
      {detail && <p className="mt-1 text-[12px] text-muted-foreground/70">{detail}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SujetsList({ subjects, siteId }: {
  subjects: NavigableSubjectSummary[]
  siteId: string
}) {
  const [tab, setTab] = useState<Tab>('surveiller')
  const nowMs = Date.now()

  // Bucket map — calculé une seule fois, réutilisé dans les tabs et le tri "Tout"
  const bucketOf = new Map<string, Bucket>()
  const buckets: Record<Bucket, NavigableSubjectSummary[]> = { watch: [], moving: [], open: [], knowledge: [], closed: [] }
  for (const s of subjects) {
    const b = getBucket(s, nowMs)
    bucketOf.set(s.canonicalSubjectId, b)
    buckets[b].push(s)
  }

  // Chantier "jeune" = aucun sujet n'a été vu dans plus d'un PV.
  // Sur un tel chantier, la stagnation est structurellement impossible (2 occurrences
  // consécutives requises), donc "À surveiller" sera naturellement vide.
  const sitePvCount = subjects.length > 0 ? Math.max(...subjects.map((s) => s.pvCount)) : 0
  const isYoungSite = sitePvCount <= 1

  // Radar de premier PV — tous les sujets opérationnels, triés par priorité déterministe
  const radarSorted = isYoungSite
    ? subjects
        .filter((s) => youngSiteRadarPriority(s) < 99)
        .sort((a, b) =>
          youngSiteRadarPriority(a) - youngSiteRadarPriority(b) ||
          b.activeObjects.total - a.activeObjects.total
        )
    : []
  const radarToTreat = radarSorted.filter((s) => s.activeObjects.total > 0)
  const radarToKnow  = radarSorted.filter((s) => s.activeObjects.total === 0)

  function renderContent() {
    if (tab === 'surveiller') {
      if (buckets.watch.length > 0) {
        return <ul className="space-y-1.5">{buckets.watch.map((s) => <li key={s.canonicalSubjectId}><SubjectCard subject={s} siteId={siteId} bucket="watch" /></li>)}</ul>
      }
      return (
        <div className="space-y-4">
          <EmptyTab
            message="Aucun signal de stagnation pour l'instant."
            detail={isYoungSite ? "Pas encore assez de comptes rendus comparables pour détecter une stagnation." : undefined}
          />
          {isYoungSite && radarSorted.length > 0 && (
            <>
              {radarToTreat.length > 0 && (
                <section className="space-y-1.5">
                  <SectionHeader label="À traiter maintenant" count={radarToTreat.length} />
                  <ul className="space-y-1.5">
                    {radarToTreat.map((s) => (
                      <li key={s.canonicalSubjectId}>
                        <SubjectCard subject={s} siteId={siteId} bucket={bucketOf.get(s.canonicalSubjectId) ?? 'moving'} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {radarToKnow.length > 0 && (
                <section className="space-y-1.5">
                  <SectionHeader label="À connaître dès maintenant" count={radarToKnow.length} />
                  <ul className="space-y-1.5">
                    {radarToKnow.map((s) => (
                      <li key={s.canonicalSubjectId}>
                        <SubjectCard subject={s} siteId={siteId} bucket={bucketOf.get(s.canonicalSubjectId) ?? 'open'} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )
    }

    if (tab === 'mouvement') {
      return buckets.moving.length > 0
        ? <ul className="space-y-1.5">{buckets.moving.map((s) => <li key={s.canonicalSubjectId}><SubjectCard subject={s} siteId={siteId} bucket="moving" /></li>)}</ul>
        : <EmptyTab message="Aucun sujet n'a évolué récemment." />
    }

    if (tab === 'attente') {
      return buckets.open.length > 0
        ? <ul className="space-y-1.5">{buckets.open.map((s) => <li key={s.canonicalSubjectId}><SubjectCard subject={s} siteId={siteId} bucket="open" /></li>)}</ul>
        : <EmptyTab message="Aucun sujet actuellement identifié comme en attente." />
    }

    // Tout — regroupé par nature du sujet
    const notClosed = (s: NavigableSubjectSummary) => !CLOSED_STATUSES.has(s.currentStatus ?? '')
    const operational = subjects.filter((s) => notClosed(s) && getKindGroup(s) === 'operational')
    const knowledge   = subjects.filter((s) => notClosed(s) && getKindGroup(s) === 'knowledge')
    const deadlines   = subjects.filter((s) => notClosed(s) && getKindGroup(s) === 'deadline')
    const actors      = subjects.filter((s) => notClosed(s) && getKindGroup(s) === 'actor')

    const bOf = (s: NavigableSubjectSummary) => bucketOf.get(s.canonicalSubjectId) ?? 'open'

    return (
      <div className="space-y-4">
        <SubjectSection subjects={operational} siteId={siteId} label="Opérationnel"             bucketFor={bOf} />
        <SubjectSection subjects={knowledge}   siteId={siteId} label="Technique · connaissances" bucketFor={bOf} />
        <SubjectSection subjects={deadlines}   siteId={siteId} label="Échéances"                 bucketFor={bOf} />
        {/* « Intervenants », pas « Acteurs » (retour Guillaume 2026-08-14) :
            le vocabulaire technique du modèle ne s'expose pas à l'utilisateur. */}
        <SubjectSection subjects={actors}      siteId={siteId} label="Intervenants"              bucketFor={bOf} />
        <SubjectSection subjects={buckets.closed} siteId={siteId} label="Clôturés"              bucketFor={() => 'closed'} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Barre de navigation principale */}
      <nav className="scrollbar-hide -mx-3 overflow-x-auto px-3">
        <ul className="flex w-max gap-1.5">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                  tab === t.id
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-card text-muted-foreground active:bg-accent',
                )}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Contenu du tab actif */}
      {subjects.length === 0
        ? <EmptyTab message="Aucun sujet documenté sur ce chantier." />
        : renderContent()
      }
    </div>
  )
}
