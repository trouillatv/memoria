import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Brain, ChevronRight } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { SiteTabs } from '../SiteTabs'

export const dynamic = 'force-dynamic'

/**
 * Vue « Sujets » — liste des canonical subjects ayant au moins une occurrence
 * réelle (native ou PDF). Les sujets techniquement existants mais sans preuve
 * utilisateur exploitable restent invisibles ici.
 *
 * Tri : les plus récemment actifs en premier (date de la dernière occurrence).
 * Pas de liste brute de 385 sujets : seuls les sujets documentés apparaissent.
 */
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

  // Sujets actifs du chantier
  const { data: csData } = await supabase
    .from('canonical_subject')
    .select('id, label, status')
    .eq('site_id', siteId)
    .eq('status', 'active')

  const subjects = (csData ?? []) as Array<{ id: string; label: string; status: string }>
  if (subjects.length === 0) {
    return (
      <div className="max-w-md space-y-5 pb-16">
        <header className="space-y-2">
          <Link href={`/m/site/${siteId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {site.name}
          </Link>
          <SiteTabs siteId={siteId} active="sujets" userRole={user.role} />
        </header>
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
          Aucun sujet documenté sur ce chantier.
        </p>
      </div>
    )
  }

  const csIds = subjects.map((s) => s.id)

  // Occurrences natives — pour savoir quels sujets sont documentés et leur date.
  // Une seule requête pour tous les sujets (pas de N+1).
  const { data: occData } = await supabase
    .from('canonical_subject_occurrence')
    .select('canonical_subject_id, effective_date, source_kind')
    .eq('site_id', siteId)
    .in('canonical_subject_id', csIds.length > 500 ? csIds.slice(0, 500) : csIds)
    .order('effective_date', { ascending: false })

  const occurrences = (occData ?? []) as Array<{
    canonical_subject_id: string
    effective_date: string
    source_kind: string
  }>

  // Agréger par sujet
  interface CsAgg {
    lastDate: string
    count: number
    hasField: boolean
    hasMeeting: boolean
    hasPdf: boolean
  }
  const aggById = new Map<string, CsAgg>()
  for (const o of occurrences) {
    const existing = aggById.get(o.canonical_subject_id)
    if (!existing) {
      aggById.set(o.canonical_subject_id, {
        lastDate: o.effective_date,
        count: 1,
        hasField: o.source_kind === 'field_visit',
        hasMeeting: o.source_kind === 'meeting',
        hasPdf: o.source_kind === 'historical_pdf',
      })
    } else {
      existing.count++
      if (o.source_kind === 'field_visit') existing.hasField = true
      if (o.source_kind === 'meeting') existing.hasMeeting = true
      if (o.source_kind === 'historical_pdf') existing.hasPdf = true
    }
  }

  // Sujets displayable = ceux avec au moins 1 occurrence native
  const displayable = subjects
    .filter((s) => aggById.has(s.id))
    .map((s) => ({ ...s, agg: aggById.get(s.id)! }))
    .sort((a, b) => b.agg.lastDate.localeCompare(a.agg.lastDate))

  const hiddenCount = subjects.length - displayable.length

  return (
    <div className="max-w-md space-y-5 pb-16">
      <header className="space-y-2">
        <Link href={`/m/site/${siteId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {site.name}
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Sujets</h1>
          <p className="text-[13px] text-muted-foreground">
            {displayable.length} sujet{displayable.length !== 1 ? 's' : ''} documenté{displayable.length !== 1 ? 's' : ''}
            {hiddenCount > 0 && (
              <span className="text-muted-foreground/70"> · {hiddenCount} sans occurrence</span>
            )}
          </p>
        </div>
        <SiteTabs siteId={siteId} active="sujets" userRole={user.role} />
      </header>

      {displayable.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
          Aucun sujet documenté pour l'instant.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {displayable.map(({ id, label, agg }) => {
            const sources: string[] = []
            if (agg.hasPdf) sources.push(`${agg.count} PV`)
            if (agg.hasField) sources.push('terrain')
            if (agg.hasMeeting) sources.push('réunion')
            const sourceLine = sources.join(' · ')
            return (
              <li key={id}>
                <Link
                  href={`/m/site/${siteId}/sujets/${id}`}
                  className="flex items-center gap-3 rounded-2xl border bg-card px-3.5 py-3 shadow-sm active:brightness-95"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
                    <Brain className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-snug">{label}</span>
                    {sourceLine && (
                      <span className="block text-[11px] text-muted-foreground">{sourceLine}</span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
