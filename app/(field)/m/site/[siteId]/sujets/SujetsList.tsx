'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Brain, BookOpen, CheckCircle2, ChevronRight } from 'lucide-react'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { isOperationalSubject } from '@/lib/subjects/kind'
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
  if (CLOSED_STATUSES.has(s.currentStatus ?? '')) return 'closed'
  if (!isOperationalSubject(s.kind))              return 'knowledge'
  if (s.isStagnant)                               return 'watch'
  const recentChange = s.lastMeaningfulChangeAt &&
    new Date(s.lastMeaningfulChangeAt).getTime() > nowMs - SIXTY_DAYS_MS
  return recentChange ? 'moving' : 'open'
}

// ── Kind grouping (vue "Tout") ─────────────────────────────────────────────────

type KindGroup = 'operational' | 'knowledge' | 'deadline' | 'actor'

const ACTOR_KIND    = new Set(['person', 'company'])
const DEADLINE_KIND = new Set(['deadline'])

function getKindGroup(s: NavigableSubjectSummary): KindGroup {
  if (ACTOR_KIND.has(s.kind ?? ''))    return 'actor'
  if (DEADLINE_KIND.has(s.kind ?? '')) return 'deadline'
  if (s.kind === 'knowledge_fact')     return 'knowledge'
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

  const isKnowledge = bucket === 'knowledge'
  const isClosed    = bucket === 'closed'

  return (
    <Link
      href={`/m/site/${siteId}/sujets/${canonicalSubjectId}`}
      className={cn(
        'flex items-start gap-3 rounded-2xl border bg-card px-3.5 py-3 shadow-sm active:brightness-95',
        isStagnant && 'border-amber-200',
        isClosed   && 'opacity-60',
      )}
    >
      <span className={cn(
        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        isStagnant  ? 'bg-amber-50' :
        isKnowledge ? 'bg-muted' :
        isClosed    ? 'bg-muted' :
                      'bg-indigo-50 dark:bg-indigo-950/40',
      )}>
        {isStagnant
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

        {isStagnant && stagnationDays > 0 && (
          <span className="mt-1 block text-[11px] text-amber-700">
            Sans évolution depuis {stagnationDays} jour{stagnationDays > 1 ? 's' : ''}
          </span>
        )}
        {!isStagnant && !isClosed && lastMeaningfulChangeAt && (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Évolué le {new Date(lastMeaningfulChangeAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
          </span>
        )}
        {activeObjects.total > 0 && (
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

function EmptyTab({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
      {message}
    </p>
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

  function renderContent() {
    if (tab === 'surveiller') {
      return buckets.watch.length > 0
        ? <ul className="space-y-1.5">{buckets.watch.map((s) => <li key={s.canonicalSubjectId}><SubjectCard subject={s} siteId={siteId} bucket="watch" /></li>)}</ul>
        : <EmptyTab message="Aucun sujet ne nécessite d'attention particulière." />
    }

    if (tab === 'mouvement') {
      return buckets.moving.length > 0
        ? <ul className="space-y-1.5">{buckets.moving.map((s) => <li key={s.canonicalSubjectId}><SubjectCard subject={s} siteId={siteId} bucket="moving" /></li>)}</ul>
        : <EmptyTab message="Aucun sujet n'a évolué récemment." />
    }

    if (tab === 'attente') {
      return buckets.open.length > 0
        ? <ul className="space-y-1.5">{buckets.open.map((s) => <li key={s.canonicalSubjectId}><SubjectCard subject={s} siteId={siteId} bucket="open" /></li>)}</ul>
        : <EmptyTab message="Aucun sujet en attente." />
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
        <SubjectSection subjects={actors}      siteId={siteId} label="Acteurs"                   bucketFor={bOf} />
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
