import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import type { NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { SujetsList } from './SujetsList'

export const dynamic = 'force-dynamic'

export default async function SujetsPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  await requireSiteAccess(siteId)

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

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Ce qui vit sur ce chantier</h1>
        <p className="text-[13px] text-muted-foreground">
          {subjects.length} sujet{subjects.length !== 1 ? 's' : ''} suivi{subjects.length !== 1 ? 's' : ''}
          {runCount > 0 && <span> · {runCount} PV</span>}
        </p>
      </header>

      <SujetsList subjects={subjects} siteId={siteId} />
    </div>
  )
}
