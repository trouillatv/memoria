import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, MapPin, Clock, CheckCircle2 } from 'lucide-react'
import {
  getIntervention,
  listChecklistItemsByIntervention,
  listPhotosByIntervention,
  getSiteResumeContext,
} from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { listSiteNotes } from '@/lib/db/sites'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSignedPhotoUrls } from '@/lib/storage/intervention-photos'
import { formatRelativeShort } from '@/lib/format'
import { ChecklistMobile } from './checklist-mobile'
import { StartInterventionButton } from './start-intervention-button'
import { AnomalyTrigger } from './anomaly-trigger'
import { CompleteButton } from './complete-button'
import { SkipInterventionTrigger } from './skip-modal'
import { PhotoCaptureButton } from './photo-capture-button'
import { AddSiteNoteButton } from './AddSiteNoteButton'
import { SiteResumeCard } from './SiteResumeCard'

export default async function FieldInterventionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const intervention = await getIntervention(id)
  if (!intervention) notFound()

  // Defensive : verify the user is in the team (RLS would also block, but better UX message)
  const isAdmin = user.role === 'admin' || user.role === 'manager'
  const isInTeam = intervention.team.includes(user.id)
  if (!isAdmin && !isInTeam) {
    return (
      <div className="rounded-lg border bg-card p-6 max-w-md">
        <p className="text-base">Cette mission n&apos;est pas la vôtre.</p>
        <Link href="/m" className="inline-block mt-3 text-sm underline">
          Retour à mes missions
        </Link>
      </div>
    )
  }

  const [mission, checklistItems, photos] = await Promise.all([
    getMission(intervention.mission_id),
    listChecklistItemsByIntervention(id),
    listPhotosByIntervention(id),
  ])

  // Sign storage URLs (1h TTL) for thumbs
  const signedUrlsMap = await getSignedPhotoUrls(photos.map((p) => p.storage_path))
  const signedUrls = Object.fromEntries(signedUrlsMap)

  // Site for context
  const supabase = createAdminClient()
  const { data: site } = mission
    ? await supabase
        .from('sites')
        .select('id, name, address')
        .eq('id', mission.site_id)
        .maybeSingle()
    : { data: null }

  // Sprint 2 — Mémoire des lieux + Mode reprise.
  // Notes courtes du site (3-5 affichées max) et contexte de reprise si
  // dernier passage > 7 jours ou premier passage.
  const siteId = mission?.site_id ?? null
  const siteNotes = siteId ? await listSiteNotes(siteId, 5) : []
  const resumeContext = siteId
    ? await getSiteResumeContext(siteId, user.id)
    : null
  const showResumeMode =
    resumeContext !== null &&
    (resumeContext.daysSinceLastVisit === null ||
      resumeContext.daysSinceLastVisit > 7)

  const scheduledDate = new Date(intervention.scheduled_at)
  const dateLabel = scheduledDate.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const timeLabel = scheduledDate.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const isInProgress = intervention.status === 'in_progress'
  const isPlanned = intervention.status === 'planned'
  const isCompleted =
    intervention.status === 'completed' || intervention.status === 'validated'
  const isSkipped =
    intervention.status === 'skipped' || intervention.skipped_at !== null

  const hasMissingRequired = checklistItems.some((i) => i.required && !i.done)

  return (
    <div className="space-y-5 max-w-md">
      <Link
        href="/m"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground active:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Mes missions
      </Link>

      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{mission?.name ?? 'Intervention'}</h1>
        {site && (
          <div className="flex items-start gap-1.5 text-base text-muted-foreground">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div>{site.name}</div>
              {site.address && <div className="text-sm">{site.address}</div>}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-base text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          <span>
            {dateLabel} · {timeLabel}
          </span>
        </div>
      </header>

      {isSkipped && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
          <div className="font-semibold">
            Cette intervention a été marquée « pas aujourd&apos;hui »
          </div>
          {intervention.skipped_reason && (
            <div className="text-sm">
              Raison&nbsp;: {intervention.skipped_reason}
            </div>
          )}
        </div>
      )}

      {!isSkipped && isPlanned && <StartInterventionButton interventionId={id} />}

      {isCompleted && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>Mission {intervention.status === 'validated' ? 'validée' : 'terminée'}</span>
        </div>
      )}

      {isInProgress && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          Mission en cours — cochez les tâches au fur et à mesure
        </div>
      )}

      {/* Sprint 2 — Mode reprise du site (au-dessus de "À savoir") */}
      {siteId && showResumeMode && resumeContext && (
        <SiteResumeCard siteId={siteId} context={resumeContext} />
      )}

      {/* Sprint 2 — Section « À savoir pour ce site ».
          Silence positif : si 0 notes → section absente, pas de placeholder. */}
      {siteId && siteNotes.length > 0 && (
        <section aria-labelledby="site-notes-heading">
          <h2
            id="site-notes-heading"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2"
          >
            <MapPin className="h-3 w-3" />À savoir pour ce site
          </h2>
          <ul className="space-y-1.5">
            {siteNotes.slice(0, 5).map((note) => (
              <li key={note.id} className="text-sm leading-relaxed">
                • {note.body}
                <span className="text-[10px] text-muted-foreground/60 ml-2">
                  ({formatRelativeShort(note.created_at)})
                </span>
              </li>
            ))}
          </ul>
          <AddSiteNoteButton siteId={siteId} />
        </section>
      )}

      {/* Cas : pas de notes ET pas de mode reprise → on permet quand même
          d'ajouter une note (premier ajout). Bouton discret seul. */}
      {siteId && siteNotes.length === 0 && !showResumeMode && (
        <AddSiteNoteButton siteId={siteId} />
      )}

      <ChecklistMobile
        interventionId={id}
        items={checklistItems}
        serverPhotos={photos}
        signedUrls={signedUrls}
        canEdit={isInProgress || isAdmin}
      />

      {isInProgress && (
        <div className="space-y-3 mt-6">
          <AnomalyTrigger interventionId={id} />
          <CompleteButton
            interventionId={id}
            hasMissingRequired={hasMissingRequired}
          />
        </div>
      )}

      {/* Slice 6.4 — Bouton « Pas aujourd'hui » sobre, uniquement si planned
          (pas commencée, pas terminée, pas déjà sautée). Placé en bas, séparé
          du CTA principal pour signaler l'usage exceptionnel. */}
      {!isSkipped && isPlanned && (
        <div className="mt-8 pt-4 border-t border-border">
          <SkipInterventionTrigger interventionId={id} />
        </div>
      )}

      {/* J2 — Bouton photo pleine-largeur sticky bas, 80px de haut.
          Doctrine V5 Pilier 5 : humidité du bloc + gants → un FAB rond rate
          2 photos sur 3. Cible large + texte gros = taux de capture plus haut. */}
      {isInProgress && (
        <>
          <div className="h-24" aria-hidden /> {/* spacer pour éviter overlap CompleteButton */}
          <div className="fixed bottom-0 inset-x-0 z-20 p-3 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none">
            <div className="pointer-events-auto max-w-md mx-auto">
              <PhotoCaptureButton
                interventionId={id}
                checklistItemId={null}
                kind="proof"
                label="Prendre une photo"
                variant="fullwidth"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
