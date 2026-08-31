import { notFound } from 'next/navigation'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { listSitePhotoCaptures, getVisitCapturePreviewUrls } from '@/lib/db/visit-captures'
import { PhotoGallery, type PhotoGroup } from './PhotoGallery'

export const dynamic = 'force-dynamic'

export default async function SitePhotosMobilePage({
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

  const photos = await listSitePhotoCaptures(siteId).catch(() => [])
  const previews = photos.length > 0
    ? await getVisitCapturePreviewUrls(photos).catch(() => ({} as Record<string, { url: string; mime: string | null }>))
    : {}

  // Dates de visite pour les en-têtes de groupe
  const reportIds = [...new Set(photos.map((p) => p.report_id))]
  const { data: reports } = reportIds.length > 0
    ? await supabase
        .from('site_reports')
        .select('id, started_at, ended_at')
        .in('id', reportIds)
    : { data: [] }

  const reportDateMap = new Map(
    ((reports ?? []) as Array<{ id: string; started_at: string | null; ended_at: string | null }>)
      .map((r) => [r.id, r.started_at ?? r.ended_at]),
  )

  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Pacific/Noumea',
  })

  // Grouper les photos par visite (report_id), dans l'ordre d'apparition (photos déjà triées DESC)
  const groupMap = new Map<string, PhotoGroup>()
  for (const p of photos) {
    if (!groupMap.has(p.report_id)) {
      const rawDate = reportDateMap.get(p.report_id) ?? p.captured_at ?? p.created_at
      groupMap.set(p.report_id, {
        reportId: p.report_id,
        dateLabel: rawDate ? dateFmt.format(new Date(rawDate)) : 'Visite',
        visitHref: `/m/visite/${p.report_id}/recap`,
        photos: [],
      })
    }
    const url = previews[p.id]?.url
    if (url) groupMap.get(p.report_id)!.photos.push({ id: p.id, url, body: p.body })
  }

  const groups = [...groupMap.values()].filter((g) => g.photos.length > 0)
  const total = groups.reduce((n, g) => n + g.photos.length, 0)

  return (
    <div className="max-w-md space-y-4 pb-16">
      <header>
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">Photos</h1>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">{total}</span>
          )}
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Aucune photo sur ce chantier pour l&apos;instant. Les photos prises pendant les visites apparaissent ici.
          </p>
        </div>
      ) : (
        <PhotoGallery groups={groups} />
      )}
    </div>
  )
}
