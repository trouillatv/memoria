import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import {
  Camera, Video, Mic, Pencil, Target, MapPin, Star, Clock, FileText, ChevronRight,
} from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { visitIntentLabel } from '@/lib/field/visit-intents'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisit, buildVisitProduction, buildSitePatrimoine } from '@/lib/db/visits'
import { buildSiteTimeline } from '@/lib/db/site-timeline'
import { buildSiteMemorySignals } from '@/lib/db/site-memory-signals'
import { listVisitCaptures, getVisitCapturePreviewUrls, type VisitCaptureRow, type VisitCaptureKind } from '@/lib/db/visit-captures'
import { ReopenVisitButton } from '../ReopenVisitButton'
import { VisitShareButton } from '../VisitShareButton'
import { VisitMemoryTabs } from './VisitMemoryTabs'

export const dynamic = 'force-dynamic'

/**
 * Récap d'une visite — la vue DURABLE, lisible à tout moment (« Voir la visite »
 * en fin de visite, et « Dernière visite » depuis la fiche chantier). Lecture
 * seule : ce qui a été relevé, assemblé, plus les sorties (CR/PDF, ordinateur).
 * Le tri se fait sur l'écran de fin ; ici on RELIT, on ne décide plus.
 */

const ORIGIN_FR: Record<string, string> = {
  planned: 'Visite planifiée', spontaneous: 'Visite spontanée', qr: 'Visite (QR)', gps: 'Visite (sur place)',
  import: 'Visite importée',
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
    timeZone: NOUMEA_TZ,
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

  // Données des onglets Évolution / Histoire / Mémoire (déterministe, réutilise la
  // mémoire du chantier). L'écran de FIN de visite, lui, reste inchangé et rapide.
  const [production, timeline, memory, patrimoine] = await Promise.all([
    // Évolution = ce que CETTE visite a produit (jamais vide) — l'histoire de la
    // valeur créée, pas un dump de compteurs.
    buildVisitProduction(reportId, visit.visit_motive === 'previsite_ao').catch(() => null),
    // Histoire = la VRAIE frise (visites incluses), pas l'ancien narratif qui les
    // omettait (d'où l'onglet vide). La visite du jour y sera mise en évidence.
    buildSiteTimeline(visit.site_id).catch(() => []),
    buildSiteMemorySignals(visit.site_id).catch(() => []),
    buildSitePatrimoine(visit.site_id).catch(() => ({ firstVisitLabel: null, photos: 0, visits: 0, meetings: 0, actions: 0, reserves: 0, subjects: 0 })),
  ])

  const visitTypeLabel = visitIntentLabel(visit.visit_motive) ?? ORIGIN_FR[visit.origin ?? ''] ?? 'Visite'
  // Une visite TERMINÉE est figée : on la consulte et on la partage, on ne la
  // « reprend » plus (un oubli = une NOUVELLE visite, fidèle au terrain).
  const isEnded = !!visit.ended_at

  return (
    <VisitMemoryTabs
      siteId={visit.site_id}
      siteName={siteName}
      visitTypeLabel={visitTypeLabel}
      production={production}
      timeline={timeline}
      currentReportId={reportId}
      memory={memory}
      patrimoine={patrimoine}
    >
      {/* Onglet 1 — « Captures » : la TRACE complète de la session (l'en-tête
          chantier et la conclusion viennent de la grammaire commune des onglets). */}
      <div className="space-y-4">
      {/* Deux lectures d'une même visite — on lève la confusion CR ↔ trace :
          le compte-rendu est une PROJECTION éditoriale (relue, synthétisée,
          destinée à être transmise) ; ici, c'est la TRACE exhaustive (tout ce
          qui a été capturé, y compris ce qui n'est pas repris dans le CR). */}
      <div className="rounded-2xl border bg-muted/20 p-3">
        <p className="text-[13px] font-medium">Deux lectures de cette visite</p>
        <div className="mt-2 space-y-1.5">
          <Link
            href={`/m/visite/${reportId}/cr`}
            className="flex items-center gap-2.5 rounded-xl border bg-background px-3 py-2.5 active:bg-accent"
          >
            <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Compte-rendu</span>
              <span className="block text-[12px] text-muted-foreground">Le document relu, structuré et partageable.</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <Camera className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Toutes les captures <span className="font-normal text-muted-foreground">· vous y êtes</span></span>
              <span className="block text-[12px] text-muted-foreground">Photos, vidéos, vocaux, notes et décisions — la trace complète.</span>
            </span>
          </div>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground first-letter:uppercase">
        {dateLabel}
        {durLabel && (
          <span className="ml-1 inline-flex items-center gap-1">
            · <Clock className="h-3.5 w-3.5" /> {durLabel}
          </span>
        )}
      </p>

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

      {/* Une visite NON terminée peut encore être reprise (cas limite). Une visite
          clôturée, elle, est figée : plus de « Reprendre » — voir les actions plus bas. */}
      {!isEnded && <ReopenVisitButton reportId={reportId} siteId={visit.site_id} />}

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

      {/* Action de partage — le compte-rendu (le document transmissible) est déjà
          proposé en tête via la distinction des deux lectures ; on ne le duplique
          pas ici. Pas de « reprendre » — la visite est figée. */}
      <div className="grid grid-cols-1 pt-2">
        <VisitShareButton reportId={reportId} siteName={siteName} />
      </div>
      </div>
    </VisitMemoryTabs>
  )
}
