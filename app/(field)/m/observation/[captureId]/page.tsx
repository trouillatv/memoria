import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Camera, Video, Mic, Pencil, HelpCircle, MapPin, ChevronRight } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisitCapturePreviewUrls, type VisitCaptureRow } from '@/lib/db/visit-captures'
import { distanceMeters, SAME_SPOT_RADIUS_M } from '@/lib/visits/geo'
import { CaptureMap } from '@/components/CaptureMap'

/**
 * FICHE D'OBSERVATION — la destination d'un point de carte (revue 2026-07-12).
 * L'intention du clic est « montre-moi CETTE photo / vidéo / note », pas
 * « rouvre le traitement ». Le modèle : chantier → visite → observation →
 * média. Consultation pure : média + date + commentaire/transcription +
 * localisation + provenance, puis « Voir la visite complète » (récap).
 * Le Débrief reste un outil de production, accessible depuis ses écrans.
 */

const KIND_META: Record<string, { label: string; Icon: typeof Camera }> = {
  photo: { label: 'Photo', Icon: Camera },
  video: { label: 'Vidéo', Icon: Video },
  vocal: { label: 'Mémo vocal', Icon: Mic },
  note: { label: 'Note', Icon: Pencil },
  question: { label: 'À vérifier', Icon: HelpCircle },
}

export default async function ObservationPage({
  params,
}: {
  params: Promise<{ captureId: string }>
}) {
  const { captureId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('visit_capture')
    .select('*')
    .eq('id', captureId)
    .maybeSingle()
  const capture = data as VisitCaptureRow | null
  if (!capture) notFound()

  // Portée organisation : l'observation appartient à un chantier de l'org.
  const { data: siteRow } = await supabase
    .from('sites')
    .select('id, name, organization_id')
    .eq('id', capture.site_id)
    .maybeSingle()
  const site = siteRow as { id: string; name: string; organization_id: string | null } | null
  if (!site || (user.organization_id && site.organization_id !== user.organization_id)) notFound()

  // Provenance : la visite (ou réunion) qui a produit l'observation.
  const { data: reportRow } = await supabase
    .from('site_reports')
    .select('id, origin, created_at')
    .eq('id', capture.report_id)
    .maybeSingle()
  const report = reportRow as { id: string; origin: string | null; created_at: string } | null

  // « PRIS AU MÊME ENDROIT » (Vincent 2026-07-12) : les autres captures de la
  // même visite à portée de quelques pas (rayon GPS) — une position nue prend
  // sens quand on voit la photo ou la vidéo prises là. Déterministe.
  let sameSpot: VisitCaptureRow[] = []
  if (capture.lat !== null && capture.lng !== null) {
    const { data: siblings } = await supabase
      .from('visit_capture')
      .select('*')
      .eq('report_id', capture.report_id)
      .neq('id', capture.id)
      .not('lat', 'is', null)
      .limit(50)
    sameSpot = (((siblings ?? []) as VisitCaptureRow[])
      .map((s) => ({ s, d: distanceMeters(capture.lat!, capture.lng!, s.lat!, s.lng!) }))
      .filter((x) => x.d <= SAME_SPOT_RADIUS_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.s))
  }

  const previews = await getVisitCapturePreviewUrls([capture, ...sameSpot])
  const media = previews[capture.id] ?? null
  const meta = KIND_META[capture.kind] ?? { label: capture.kind, Icon: Camera }
  const takenIso = capture.captured_at ?? capture.created_at
  const takenLabel = new Date(takenIso).toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Noumea',
  })
  const visitDateLabel = report
    ? new Date(report.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Pacific/Noumea' })
    : null

  const isImage = capture.kind === 'photo' || (media?.mime?.startsWith('image/') ?? false)
  const isVideo = capture.kind === 'video' || (media?.mime?.startsWith('video/') ?? false)
  const isAudio = capture.kind === 'vocal' || (media?.mime?.startsWith('audio/') ?? false)

  return (
    <div className="max-w-md space-y-4 pb-24">
      <header className="space-y-0.5 pt-1">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <meta.Icon className="h-4 w-4" /> {meta.label}
        </p>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{takenLabel}</p>
        <Link href={`/m/site/${site.id}`} className="inline-flex items-center gap-1 text-sm font-medium active:opacity-70">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {site.name}
        </Link>
      </header>

      {/* Le média d'abord — c'est lui qu'on est venu voir. */}
      {media && isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt={meta.label} className="w-full rounded-2xl border object-contain" />
      )}
      {media && isVideo && (
        <video src={media.url} controls playsInline className="w-full rounded-2xl border" />
      )}
      {media && isAudio && (
        <audio src={media.url} controls className="w-full" />
      )}

      {/* Commentaire / transcription — le texte de l'observation. */}
      {capture.body?.trim() && (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isAudio ? 'Transcription' : 'Commentaire'}
          </h2>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed">{capture.body}</p>
        </section>
      )}

      {/* Localisation — la même carte que partout, réduite à ce point. */}
      {capture.lat !== null && capture.lng !== null && (
        <CaptureMap
          siteId={site.id}
          heightClass="h-52"
          linkPopups={false}
          captures={[{
            id: capture.id,
            kind: capture.kind,
            lat: capture.lat,
            lng: capture.lng,
            created_at: takenIso,
            body: capture.body,
            reportId: capture.report_id,
            subjectName: null,
          }]}
        />
      )}

      {/* PRIS AU MÊME ENDROIT — l'image ou la vidéo capturée là, en encart.
          Chaque miniature ouvre SA fiche d'observation. */}
      {sameSpot.length > 0 && (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pris au même endroit
          </h2>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {sameSpot.map((s) => {
              const p = previews[s.id]
              const m = KIND_META[s.kind] ?? { label: s.kind, Icon: Camera }
              return (
                <Link
                  key={s.id}
                  href={`/m/observation/${s.id}`}
                  className="group relative aspect-square overflow-hidden rounded-xl border bg-muted/40 active:opacity-70"
                  aria-label={m.label}
                >
                  {p && (s.kind === 'photo' || p.mime?.startsWith('image/')) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={m.label} className="h-full w-full object-cover" />
                  ) : p && (s.kind === 'video' || p.mime?.startsWith('video/')) ? (
                    <video src={p.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <m.Icon className="h-5 w-5 text-muted-foreground" />
                    </span>
                  )}
                  <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
                    {m.label}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Provenance — d'où vient cette observation, et la porte vers le tout. */}
      {report && (
        <Link
          href={`/m/visite/${report.id}/recap`}
          className="flex items-center gap-3 rounded-2xl border bg-card p-4 active:bg-muted/40"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">
              {report.origin ? 'Capturée pendant la visite' : 'Issue de la réunion'}
              {visitDateLabel ? ` du ${visitDateLabel}` : ''}
            </span>
            <span className="mt-0.5 block text-[13px] text-muted-foreground">Voir la visite complète</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      )}
    </div>
  )
}
