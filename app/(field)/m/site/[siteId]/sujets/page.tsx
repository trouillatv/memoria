import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, AlertCircle, Brain, ChevronRight } from 'lucide-react'
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

// ── Sub-component ─────────────────────────────────────────────────────────────

function SubjectCard({ subject, siteId }: { subject: NavigableSubjectSummary; siteId: string }) {
  const { canonicalSubjectId, title, currentStatus, pvCount, nativeOccurrenceCount,
    isStagnant, stagnationDays, lastMeaningfulChangeAt } = subject

  const statusLabel = currentStatus ? (STATUS_LABELS[currentStatus] ?? currentStatus) : null
  const statusColor = currentStatus ? (STATUS_COLORS[currentStatus] ?? 'bg-muted text-muted-foreground') : null

  const sourceFragments: string[] = []
  if (pvCount > 0) sourceFragments.push(`${pvCount} PV`)
  if (nativeOccurrenceCount > 0) sourceFragments.push('terrain')
  const sourceLine = sourceFragments.join(' · ')

  return (
    <Link
      href={`/m/site/${siteId}/sujets/${canonicalSubjectId}`}
      className={cn(
        'flex items-start gap-3 rounded-2xl border bg-card px-3.5 py-3 shadow-sm active:brightness-95',
        isStagnant && 'border-amber-200',
      )}
    >
      {/* Icône */}
      <span className={cn(
        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
        isStagnant ? 'bg-amber-50' : 'bg-indigo-50 dark:bg-indigo-950/40',
      )}>
        {isStagnant
          ? <AlertCircle className="h-4 w-4 text-amber-600" />
          : <Brain className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
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
        {!isStagnant && lastMeaningfulChangeAt && (
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Évolué le {new Date(lastMeaningfulChangeAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
          </span>
        )}
      </span>

      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
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

  const runCount    = runsResult.count ?? 0
  const stagnantCount = subjects.filter((s) => s.isStagnant).length
  const closedCount   = subjects.filter((s) => ['done', 'cancelled', 'not_applicable'].includes(s.currentStatus ?? '')).length

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
          {(stagnantCount > 0 || closedCount > 0) && (
            <p className="text-[12px] text-muted-foreground">
              {stagnantCount > 0 && (
                <span className="text-amber-700">{stagnantCount} à surveiller</span>
              )}
              {stagnantCount > 0 && closedCount > 0 && ' · '}
              {closedCount > 0 && `${closedCount} clôturé${closedCount > 1 ? 's' : ''}`}
            </p>
          )}
        </div>

        <SiteTabs siteId={siteId} active="sujets" userRole={user.role} />
      </header>

      {subjects.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
          Aucun sujet documenté sur ce chantier.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {subjects.map((s) => (
            <li key={s.canonicalSubjectId}>
              <SubjectCard subject={s} siteId={siteId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
