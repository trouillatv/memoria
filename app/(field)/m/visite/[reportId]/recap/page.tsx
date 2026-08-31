import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NOUMEA_TZ } from '@/lib/time/local-date'
import {
  Camera, Video, Mic, Pencil, Target, MapPin, Star, Clock, FileText, ChevronRight, Sparkles, CheckCircle2,
} from 'lucide-react'
import { getVisitCrDocument } from '@/lib/db/visit-cr-documents'
import { getCurrentUserWithProfile, userBelongsToOrg } from '@/lib/db/users'
import { visitIntentLabel } from '@/lib/field/visit-intents'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVisit, buildSitePatrimoine } from '@/lib/db/visits'
import { buildVisitChanges } from '@/lib/db/visit-narrative'
import { projectVisitObjects } from '@/lib/db/visit-objects'
import { buildSiteTimeline } from '@/lib/db/site-timeline'
import { buildSiteMemorySignals } from '@/lib/db/site-memory-signals'
import { listVisitCaptures, getVisitCapturePreviewUrls, type VisitCaptureRow, type VisitCaptureKind } from '@/lib/db/visit-captures'
import { getSiteCoverCaptureId } from '@/lib/db/site-cover'
import { CoverPhotoButton } from '../CoverPhotoButton'
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
  if (visit.organization_id && !(await userBelongsToOrg(user.id, visit.organization_id))) {
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
  // Photo principale du chantier (mig 243) — pour marquer la photo active.
  const coverCaptureId = await getSiteCoverCaptureId(visit.site_id).catch(() => null)

  const startIso = visit.started_at ?? visit.created_at
  const dateLabel = new Date(startIso).toLocaleString('fr-FR', {
    timeZone: NOUMEA_TZ,
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
  const durMins = visit.started_at && visit.ended_at
    ? Math.max(0, Math.round((new Date(visit.ended_at).getTime() - new Date(visit.started_at).getTime()) / 60000))
    : null
  const durLabel = durMins == null ? null : durMins < 60 ? `${durMins} min` : `${Math.floor(durMins / 60)} h ${durMins % 60} min`

  const isImportedVisit = visit.origin === 'import'

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
  const [changes, timeline, memory, patrimoine] = await Promise.all([
    // Impact = les objets métier RÉELLEMENT produits par cette visite, lus depuis
    // l'UNIQUE read-model partagé desktop/mobile (buildVisitChanges). Le mobile en
    // est une PROJECTION (projectVisitObjects) : même vérité, rendu différent.
    buildVisitChanges(reportId).catch(() => []),
    // Histoire = la VRAIE frise (visites incluses), pas l'ancien narratif qui les
    // omettait (d'où l'onglet vide). La visite du jour y sera mise en évidence.
    buildSiteTimeline(visit.site_id).catch(() => []),
    buildSiteMemorySignals(visit.site_id).catch(() => []),
    buildSitePatrimoine(visit.site_id).catch(() => ({ firstVisitLabel: null, firstDocDateLabel: null, photos: 0, visits: 0, importedDocs: 0, meetings: 0, actions: 0, reserves: 0, subjects: 0 })),
  ])

  // Projection mobile du read-model partagé — mêmes objets que le desktop VisitDesk.
  const objects = projectVisitObjects(changes, visit.site_id)

  const visitTypeLabel = visitIntentLabel(visit.visit_motive) ?? ORIGIN_FR[visit.origin ?? ''] ?? 'Visite'
  // Une visite TERMINÉE est figée : on la consulte et on la partage, on ne la
  // « reprend » plus (un oubli = une NOUVELLE visite, fidèle au terrain).
  const isEnded = !!visit.ended_at

  // P0-H — clôture documentaire : le libellé de l'entrée « Compte-rendu » dit
  // l'état RÉEL du document (final figé / brouillon / pas encore de matière),
  // jamais un état espéré. Lecture seule — aucune création ici.
  const crDoc = isEnded ? await getVisitCrDocument(reportId).catch(() => null) : null
  const crFinal = !!crDoc && crDoc.status !== 'draft'
  const endLabel = visit.ended_at
    ? new Date(visit.ended_at).toLocaleTimeString('fr-FR', { timeZone: NOUMEA_TZ, hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <VisitMemoryTabs
      siteId={visit.site_id}
      siteName={siteName}
      visitTypeLabel={visitTypeLabel}
      objects={objects}
      timeline={timeline}
      currentReportId={reportId}
      memory={memory}
      patrimoine={patrimoine}
    >
      {/* Onglet 1 — « Captures » : la TRACE complète de la session (l'en-tête
          chantier et la conclusion viennent de la grammaire commune des onglets). */}
      <div className="space-y-4">
      {/* P0-H — l'irréversibilité se DIT dès l'entrée : une visite clôturée
          appartient à l'historique, elle ne se fabrique plus. */}
      {isEnded ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Visite clôturée</p>
            <p className="text-[12px] text-emerald-800/80 first-letter:uppercase dark:text-emerald-300/80">
              {dateLabel}
              {endLabel && ` → ${endLabel}`}
              {durLabel && ` · ${durLabel}`}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground first-letter:uppercase">
          {dateLabel}
          {durLabel && (
            <span className="ml-1 inline-flex items-center gap-1">
              · <Clock className="h-3.5 w-3.5" /> {durLabel}
            </span>
          )}
        </p>
      )}

      {/* Trois lectures, hiérarchisées : le DOCUMENT final d'abord, la
          COMPRÉHENSION (comment MemorIA est passée du terrain à l'information)
          ensuite, la TRACE brute exhaustive enfin. Le libellé du compte-rendu
          dit l'état réel du document — final figé ou brouillon. */}
      <div className="rounded-2xl border bg-muted/20 p-3">
        <p className="text-[13px] font-medium">Trois lectures de cette visite</p>
        <div className="mt-2 space-y-1.5">
          <Link
            href={`/m/visite/${reportId}/cr`}
            className="flex items-center gap-2.5 rounded-xl border bg-background px-3 py-2.5 active:bg-accent"
          >
            <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {crFinal ? 'Compte-rendu final' : isEnded && crDoc ? 'Compte-rendu (brouillon)' : 'Compte-rendu'}
              </span>
              <span className="block text-[12px] text-muted-foreground">
                {crFinal
                  ? 'Le document clôturé de la visite.'
                  : isEnded && crDoc
                  ? 'En cours de finalisation — relire, corriger, finaliser.'
                  : 'Le document relu, structuré et partageable.'}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
          <Link
            href={`/m/visite/${reportId}/comprehension`}
            className="flex items-center gap-2.5 rounded-xl border bg-background px-3 py-2.5 active:bg-accent"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-violet-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Comment MemorIA a compris</span>
              <span className="block text-[12px] text-muted-foreground">Interprétations et éléments produits à partir des captures.</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <Camera className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Captures originales <span className="font-normal text-muted-foreground">· vous y êtes</span></span>
              <span className="block text-[12px] text-muted-foreground">Photos, vidéos, vocaux, notes — la trace brute exhaustive.</span>
            </span>
          </div>
        </div>
      </div>

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
        isImportedVisit ? (
          <div className="rounded-xl border bg-sky-50/50 px-4 py-4 text-[13px] text-muted-foreground dark:bg-sky-950/20">
            <p className="font-medium text-foreground">Visite importée depuis un PV historique</p>
            <p className="mt-0.5">Les photos, propositions et objets créés sont accessibles depuis le compte-rendu.</p>
          </div>
        ) : (
          <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            Rien n&apos;a été retenu pour cette visite.
          </p>
        )
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
                  <>
                    <a href={preview.url} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview.url} alt="" className="max-h-48 w-full rounded-lg border object-cover" />
                    </a>
                    {visit.site_id && (
                      <div className="mt-2">
                        <CoverPhotoButton siteId={visit.site_id} captureId={c.id} isCover={c.id === coverCaptureId} />
                      </div>
                    )}
                  </>
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
