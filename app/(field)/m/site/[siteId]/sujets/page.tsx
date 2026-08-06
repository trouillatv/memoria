import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, AlertCircle, Brain, BookOpen, CheckCircle2, ChevronRight } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { cn } from '@/lib/utils'
import { SiteTabs } from '../SiteTabs'

export const dynamic = 'force-dynamic'

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

const CLOSED_STATUSES  = new Set(['done', 'cancelled', 'not_applicable'])
const KNOWLEDGE_KINDS  = new Set(['person', 'company', 'knowledge_fact'])
const SIXTY_DAYS_MS    = 60 * 86_400_000

type Bucket = 'watch' | 'moving' | 'open' | 'knowledge' | 'closed'

function getBucket(s: NavigableSubjectSummary, nowMs: number): Bucket {
  if (CLOSED_STATUSES.has(s.currentStatus ?? ''))  return 'closed'
  if (KNOWLEDGE_KINDS.has(s.kind ?? ''))           return 'knowledge'
  if (s.isStagnant)                                return 'watch'
  const recentChange = s.lastMeaningfulChangeAt &&
    new Date(s.lastMeaningfulChangeAt).getTime() > nowMs - SIXTY_DAYS_MS
  if (recentChange) return 'moving'
  return 'open'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ label, count, className }: { label: string; count: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 pt-1', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{count}</span>
    </div>
  )
}

function SubjectCard({ subject, siteId, bucket }: { subject: NavigableSubjectSummary; siteId: string; bucket: Bucket }) {
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
        isClosed && 'opacity-60',
      )}
    >
      {/* Icône */}
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
              : <Brain className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        }
      </span>

      {/* Corps */}
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
            {activeObjects.actionsOpen > 0 && activeObjects.total > 1 && ` · ${activeObjects.actionsOpen} action${activeObjects.actionsOpen > 1 ? 's' : ''}`}
          </span>
        )}
      </span>

      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function SubjectGroup({ subjects, siteId, bucket, label }: {
  subjects: NavigableSubjectSummary[]
  siteId: string
  bucket: Bucket
  label: string
}) {
  if (subjects.length === 0) return null
  return (
    <section className="space-y-1.5">
      <SectionHeader label={label} count={subjects.length} />
      <ul className="space-y-1.5">
        {subjects.map((s) => (
          <li key={s.canonicalSubjectId}>
            <SubjectCard subject={s} siteId={siteId} bucket={bucket} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SujetsPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { user } = await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const [subjects, runsResult] = await Promise.all([
    getNavigableSubjectsForSite(siteId).catch(() => [] as NavigableSubjectSummary[]),
    supabase
      .from('document_extraction_run')
      .select('id', { count: 'exact', head: true })
      .eq('target_site_id', siteId)
      .eq('is_canonical', true),
  ])

  const runCount = runsResult.count ?? 0
  const nowMs    = Date.now()

  const buckets: Record<Bucket, NavigableSubjectSummary[]> = {
    watch: [], moving: [], open: [], knowledge: [], closed: [],
  }
  for (const s of subjects) {
    buckets[getBucket(s, nowMs)].push(s)
  }

  return (
    <div className="max-w-md space-y-5 pb-16">
      <header className="space-y-2">
        <Link
          href={`/m/site/${siteId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {(site as { name: string }).name}
        </Link>

        <div>
          <h1 className="text-xl font-semibold">Ce qui vit sur ce chantier</h1>
          <p className="text-[13px] text-muted-foreground">
            {subjects.length} sujet{subjects.length !== 1 ? 's' : ''} suivi{subjects.length !== 1 ? 's' : ''}
            {runCount > 0 && <span> · {runCount} PV</span>}
          </p>
        </div>

        <SiteTabs siteId={siteId} active="sujets" userRole={user.role} />
      </header>

      {subjects.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
          Aucun sujet documenté sur ce chantier.
        </p>
      ) : (
        <div className="space-y-4">
          <SubjectGroup subjects={buckets.watch}     siteId={siteId} bucket="watch"     label="À surveiller" />
          <SubjectGroup subjects={buckets.moving}    siteId={siteId} bucket="moving"    label="En mouvement" />
          <SubjectGroup subjects={buckets.open}      siteId={siteId} bucket="open"      label="En attente · ouverts" />
          <SubjectGroup subjects={buckets.knowledge} siteId={siteId} bucket="knowledge" label="Connaissances du chantier" />
          <SubjectGroup subjects={buckets.closed}    siteId={siteId} bucket="closed"    label="Clôturés" />
        </div>
      )}
    </div>
  )
}
