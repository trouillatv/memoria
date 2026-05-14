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
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'
import { formatRelativeShort } from '@/lib/format'
import { ChecklistMobile } from './checklist-mobile'
import { StartInterventionButton } from './start-intervention-button'
import { AnomalyTrigger } from './anomaly-trigger'
import { CompleteButton } from './complete-button'
import { SkipInterventionTrigger } from './skip-modal'
import { AddSiteNoteButton } from './AddSiteNoteButton'
import { SiteResumeCard } from './SiteResumeCard'
import { SiteAccessCard } from './SiteAccessCard'

export default async function FieldInterventionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  const intervention = await getIntervention(id)
  if (!intervention) notFound()

  // Defensive : verify the user is in the team (RLS would also block, but better UX message)
  // V5.1 fix : check legacy team[] ET assigned_team_id via team_members
  // (doctrine V2). Sans le 2e check, les chefs comme Moana sont rejetes
  // meme quand ils sont membres actifs de la team affectee a l'intervention.
  const isAdmin = user.role === 'admin' || user.role === 'manager'
  const isInLegacyTeam = intervention.team.includes(user.id)
  let isInAssignedTeam = false
  if (!isAdmin && !isInLegacyTeam && intervention.assigned_team_id) {
    const supabase = createAdminClient()
    const { data: membership } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', intervention.assigned_team_id)
      .eq('user_id', user.id)
      .is('left_at', null)
      .maybeSingle()
    isInAssignedTeam = !!membership
  }
  if (!isAdmin && !isInLegacyTeam && !isInAssignedTeam) {
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

  // Sign storage URLs (1h TTL) — variante thumb 400×400 pour la liste mobile.
  const signedUrlsMap = await getSignedPhotoUrlsThumb(photos.map((p) => p.storage_path))
  const signedUrls = Object.fromEntries(signedUrlsMap)

  // Site for context — champs structurés inclus pour l'écran terrain
  // (code d'entrée, contact, accès… utiles à l'arrivée sur site).
  const supabase = createAdminClient()
  const { data: site } = mission
    ? await supabase
        .from('sites')
        .select(
          'id, name, address, notes, access_code, alarm_code, contact_name, contact_phone, access_hours, access_instructions',
        )
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
  // V5.1 — créneau nommé (Matin/Après-midi/Soir) au lieu de l'heure précise.
  // Cohérent avec la doctrine V2 : créneaux nommés, jamais d'heures.
  const SLOT_LABELS: Record<string, string> = {
    morning: 'Matin',
    afternoon: 'Après-midi',
    evening: 'Soir',
  }
  // Badge coloré doux selon le créneau (teinte chaude → froide au fil du jour).
  // Cohérent doctrine V5.1 : pas de couleur sémantique alarmiste, juste
  // une signature visuelle descriptive du moment.
  const SLOT_BADGE_CLASSES: Record<string, string> = {
    morning: 'bg-amber-100 text-amber-900 border-amber-200',
    afternoon: 'bg-sky-100 text-sky-900 border-sky-200',
    evening: 'bg-indigo-100 text-indigo-900 border-indigo-200',
  }
  const slotLabel = intervention.slot ? SLOT_LABELS[intervention.slot] : null
  const slotBadgeClass = intervention.slot
    ? SLOT_BADGE_CLASSES[intervention.slot] ?? 'bg-muted text-foreground border-border'
    : 'bg-muted text-foreground border-border'

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
        <h1 className="text-xl font-semibold">{site?.name ?? 'Intervention'}</h1>
        {site && (
          <div className="flex items-start gap-1.5 text-base text-muted-foreground">
            <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              {mission && <div>{mission.name}</div>}
              {site.address && <div className="text-sm">{site.address}</div>}
              {site.notes && (
                <div className="text-sm italic text-slate-600 mt-1 whitespace-pre-wrap">
                  {site.notes}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 text-base text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0" />
            <span>{dateLabel}</span>
          </div>
          {slotLabel && (
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full border text-sm font-medium ${slotBadgeClass}`}
            >
              {slotLabel}
            </span>
          )}
        </div>
      </header>

      {isSkipped && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
          <div className="font-semibold">
            Opération annulée pour ce jour
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

      {/* Fiche site — infos pratiques (code entrée, contact, accès).
          Affichée en haut juste après le header (besoin EN ARRIVANT).
          Repliée par défaut si intervention déjà in_progress : l'agent
          est sur place, le code n'est plus utile, on libère la place
          pour la checklist. */}
      {site && <SiteAccessCard site={site} collapsed={isInProgress} />}

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

      {/* V5.1 — Bouton photo sticky bas retiré : redondant avec les boutons
          photo de la checklist (1 par item) et avec le FAB Photo libre sur
          /m/site/[id] pour les traces spontanées. */}
    </div>
  )
}
