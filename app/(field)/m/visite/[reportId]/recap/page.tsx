import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft, Camera, Video, Mic, Pencil, Target, MapPin, Star, Clock,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisit } from '@/lib/db/visits'
import { listVisitCaptures, getVisitCapturePreviewUrls, type VisitCaptureRow, type VisitCaptureKind } from '@/lib/db/visit-captures'
import { VisitOutputActions } from '../VisitOutputActions'
import { ReopenVisitButton } from '../ReopenVisitButton'

export const dynamic = 'force-dynamic'

/**
 * Récap d'une visite — la vue DURABLE, lisible à tout moment (« Voir la visite »
 * en fin de visite, et « Dernière visite » depuis la fiche chantier). Lecture
 * seule : ce qui a été relevé, assemblé, plus les sorties (CR/PDF, ordinateur).
 * Le tri se fait sur l'écran de fin ; ici on RELIT, on ne décide plus.
 */

const ORIGIN_FR: Record<string, string> = {
  planned: 'Visite planifiée', spontaneous: 'Visite spontanée', qr: 'Visite (QR)', gps: 'Visite (sur place)',
}

const KIND_ICON: Record<VisitCaptureKind, typeof Camera> = {
  photo: Camera, video: Video, vocal: Mic, note: Pencil, verification: Target, position: MapPin,
}

function captureLabel(c: VisitCaptureRow): string {
  switch (c.kind) {
    case 'photo': return 'Photo'
    case 'video': return 'Vidéo'
    case 'vocal': return c.body?.trim() ? `« ${c.body.trim()} »` : 'Mémo vocal'
    case 'note': return c.body ?? 'Note'
    case 'verification': return c.body?.trim() ? `Point vérifié — ${c.body.trim()}` : 'Point vérifié'
    case 'position': return 'Position enregistrée'
  }
}

export default async function VisitRecapPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const visit = await getVisit(reportId)
  if (!visit || !visit.site_id) notFound()
  if (visit.organization_id && user.organization_id && visit.organization_id !== user.organization_id) {
    notFound()
  }

  const supabase = createAdminClient()
  const { data: site } = await supabase.from('sites').select('name').eq('id', visit.site_id).maybeSingle()
  const siteName = (site as { name: string } | null)?.name ?? 'Chantier'

  // On ne montre PAS ce qui a été écarté au tri : la récap raconte la visite retenue.
  const allCaptures = await listVisitCaptures(reportId)
  const captures = allCaptures.filter((c) => c.status !== 'discarded')
  const previews: Record<string, { url: string; mime: string | null }> =
    await getVisitCapturePreviewUrls(captures).catch(() => ({}))

  const startIso = visit.started_at ?? visit.created_at
  const dateLabel = new Date(startIso).toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
  const durMins = visit.started_at && visit.ended_at
    ? Math.max(0, Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60000))
    : null
  const durLabel = durMins == null ? null : durMins < 60 ? `${durMins} min` : `${Math.floor(durMins / 60)} h ${durMins % 60} min`

  const tally = {
    photo: captures.filter((c) => c.kind === 'photo').length,
    video: captures.filter((c) => c.kind === 'video').length,
    vocal: captures.filter((c) => c.kind === 'vocal').length,
    note: captures.filter((c) => c.kind === 'note').length,
    starred: captures.filter((c) => c.starred).length,
  }
  const summaryChips: Array<{ icon: typeof Camera; n: number; cls?: string }> = [
    { icon: Camera, n: tally.photo },
    { icon: Video, n: tally.video },
    { icon: Mic, n: tally.vocal },
    { icon: Pencil, n: tally.note },
    { icon: Star, n: tally.starred, cls: 'text-amber-500' },
  ].filter((c) => c.n > 0)

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-40">
      <Link
        href={`/m/site/${visit.site_id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Chantier
      </Link>

      <header className="space-y-1 pt-1">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">{ORIGIN_FR[visit.origin ?? ''] ?? 'Visite'}</p>
        <h1 className="text-xl font-semibold">{siteName}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">
          {dateLabel}
          {durLabel && (
            <span className="ml-1 inline-flex items-center gap-1">
              · <Clock className="h-3.5 w-3.5" /> {durLabel}
            </span>
          )}
        </p>
      </header>

      {summaryChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm">
          {summaryChips.map((c, i) => {
            const Icon = c.icon
            return (
              <span key={i} className="inline-flex items-center gap-1">
                <Icon className={`h-4 w-4 ${c.cls ?? 'text-muted-foreground'}`} />
                <span className="tabular-nums font-medium">{c.n}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* Action PRINCIPALE : reprendre la visite. Une visite n'est jamais figée. */}
      <ReopenVisitButton reportId={reportId} siteId={visit.site_id} />

      {captures.length === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Rien n&apos;a été retenu pour cette visite.
        </p>
      ) : (
        <ul className="space-y-2">
          {captures.map((c) => {
            const Icon = KIND_ICON[c.kind]
            const preview = previews[c.id]
            return (
              <li key={c.id} className="rounded-xl border p-3">
                <div className="flex items-start gap-2.5">
                  <span className="shrink-0 pt-0.5 text-emerald-700/80"><Icon className="h-4 w-4" /></span>
                  <p className="min-w-0 flex-1 text-sm leading-snug">{captureLabel(c)}</p>
                  {c.starred && <Star className="h-4 w-4 shrink-0 text-amber-500" />}
                </div>
                {preview && c.kind === 'photo' && (
                  <a href={preview.url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview.url} alt="" className="max-h-48 w-full rounded-lg border object-cover" />
                  </a>
                )}
                {preview && c.kind === 'video' && (
                  <video src={preview.url} controls playsInline className="mt-2 max-h-56 w-full rounded-lg border bg-black" />
                )}
                {preview && c.kind === 'vocal' && (
                  <audio src={preview.url} controls className="mt-2 w-full" />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Sorties de la visite — mêmes que l'écran de fin (hors « Voir la visite »). */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-md">
          <VisitOutputActions reportId={reportId} siteId={visit.site_id} showViewVisit={false} />
        </div>
      </div>
    </div>
  )
}
