import { notFound } from 'next/navigation'
import Link from 'next/link'
import { MapPin, Clock, Check, AlertTriangle } from 'lucide-react'
import {
  getIntervention,
  listChecklistItemsByIntervention,
  listPhotosByIntervention,
  listAnomaliesByIntervention,
  getSiteResumeContext,
} from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { listSiteASavoirActive } from '@/lib/db/sites'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'
import { formatRelativeShort } from '@/lib/format'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'
import { AnomalyList } from './AnomalyList'
import { ChecklistMobile } from './checklist-mobile'
import { StartInterventionButton } from './start-intervention-button'
import { AnomalyTrigger } from './anomaly-trigger'
import { CompleteButton } from './complete-button'
import { SkipInterventionTrigger } from './skip-modal'
import { RescheduleTriggerMobile } from './RescheduleTriggerMobile'
import { SmartBackLink } from '@/components/nav/SmartBackLink'
import { AddSiteNoteButton } from './AddSiteNoteButton'
import { VoiceNoteTrigger } from './VoiceNoteTrigger'
import { VoiceNoteList } from './VoiceNoteList'
import { listVoiceNotesByIntervention } from '@/lib/db/intervention-voice-notes'
import { getSignedVoiceNoteUrls } from '@/lib/storage/intervention-voice-notes'
import { SiteResumeCard } from './SiteResumeCard'
import { SiteAccessCard } from './SiteAccessCard'
import { AccessSection } from './AccessSection'
import {
  listAccessEventsByIntervention,
  getAccessReturnStatus,
  getSiteRequiresAccessHandover,
} from '@/lib/db/intervention-access-events'
import { MobileSiteReadings } from '@/components/field/MobileSiteReadings'
import {
  getSiteReadings,
  getSiteHumanContinuity,
  getSiteTransmissionReadings,
} from '@/lib/db/site-cockpit'
import { todayLocalIso } from '@/lib/time/local-date'
import { DateNav } from '../../DateNav'

export const dynamic = 'force-dynamic'

export default async function FieldInterventionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ date?: string }>
}) {
  const { id } = await params
  const query = searchParams ? await searchParams : {}
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

  const [mission, checklistItems, photos, voiceNotes, anomalies] = await Promise.all([
    getMission(intervention.mission_id),
    listChecklistItemsByIntervention(id),
    listPhotosByIntervention(id),
    listVoiceNotesByIntervention(id),
    listAnomaliesByIntervention(id),
  ])

  // Sign storage URLs (1h TTL) — variante thumb 400×400 pour la liste mobile.
  const signedUrlsMap = await getSignedPhotoUrlsThumb(photos.map((p) => p.storage_path))
  const signedUrls = Object.fromEntries(signedUrlsMap)

  const voiceNoteUrlsMap = await getSignedVoiceNoteUrls(voiceNotes.map((n) => n.storage_path))
  const voiceNotesWithUrls = voiceNotes.map((n) => ({
    ...n,
    signedUrl: voiceNoteUrlsMap.get(n.storage_path) ?? null,
  }))

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
  const siteNotes = siteId ? await listSiteASavoirActive(siteId) : []
  const resumeContext = siteId
    ? await getSiteResumeContext(siteId, user.id)
    : null
  const showResumeMode =
    resumeContext !== null &&
    (resumeContext.daysSinceLastVisit === null ||
      resumeContext.daysSinceLastVisit > 7)

  // V5.1.4 — IA perceptive périphérique sur mobile chef d'équipe (Vincent 2026-05-15).
  // "Joseph arrive sur le lieu avec connaissance préalable du tissu."
  // Plafond UI dur : 2 fragments max sur mobile, présence ambiante constante.
  const siteReadings = siteId ? await getSiteReadings(siteId) : { readings: [] }
  const siteContinuity = siteId
    ? await getSiteHumanContinuity(siteId)
    : { predecessors: [], totalChiefs: 0, teamsSucceeded: 0 }
  const siteTransmissions = siteId
    ? await getSiteTransmissionReadings(siteId, siteContinuity)
    : []
  const enrichedSiteReadings = {
    readings: [...siteTransmissions, ...siteReadings.readings],
  }

  // Preuve d'accès site — uniquement si le site est flaggé (anti-surcharge :
  // 80% des sites n'ont pas de remise de clés/badge).
  const siteRequiresHandover = siteId
    ? await getSiteRequiresAccessHandover(siteId)
    : false
  const accessEvents = siteRequiresHandover
    ? await listAccessEventsByIntervention(id)
    : []
  const accessReturn = siteRequiresHandover
    ? await getAccessReturnStatus(id)
    : { pickupNeedsReturn: false }

  // Date civile pure (scheduled_for), JAMAIS scheduled_at (timestamp UTC dérivé
  // du créneau → décale d'un jour en Nouméa pour le créneau "soir").
  const civil = intervention.scheduled_for ?? intervention.scheduled_at.slice(0, 10)
  const todayIso = todayLocalIso()
  const selectedDate = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
    ? query.date
    : civil
  const scheduledDate = new Date(civil + 'T00:00:00.000Z')
  const dateLabel = scheduledDate.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  // V6.1 (Vincent 2026-05-20) : afficher UNIQUEMENT l'heure — jamais le mot
  // « créneau / matin / après-midi / soir ». Le slot reste la base du dégradé
  // couleur du badge pour conserver un repère visuel cohérent dans la journée
  // (matinée chaude, après-midi froide, soir indigo), mais il n'est plus nommé.
  // JAMAIS pointage personne — ancrage prestation uniquement.
  const SLOT_BADGE_CLASSES: Record<string, string> = {
    morning: 'bg-amber-100 text-amber-900 border-amber-200',
    afternoon: 'bg-sky-100 text-sky-900 border-sky-200',
    evening: 'bg-indigo-100 text-indigo-900 border-indigo-200',
  }
  const timeLabel = formatInterventionTimeLabel({
    planned_start: intervention.planned_start,
    planned_end: intervention.planned_end,
    slot: intervention.slot,
  })
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

  // Détecte si l'équipe affectée a un chef d'équipe actif. Avertissement seul
  // (non-blocant) : la clôture terrain repose normalement sur un chef d'équipe.
  let teamHasNoChef = false
  if (intervention.assigned_team_id && (isPlanned || isInProgress)) {
    const { data: chefRows } = await supabase
      .from('team_members')
      .select('user:users(role)')
      .eq('team_id', intervention.assigned_team_id)
      .is('left_at', null)
    type MemberRow = { user: { role: string } | Array<{ role: string }> | null }
    const hasChef = ((chefRows ?? []) as MemberRow[]).some((m) => {
      const u = Array.isArray(m.user) ? m.user[0] : m.user
      return u?.role === 'chef_equipe'
    })
    teamHasNoChef = !hasChef
  }

  return (
    <div className="space-y-5 max-w-md">
      <DateNav todayIso={todayIso} selectedIso={selectedDate} basePath={`/m/intervention/${id}`} />

      <SmartBackLink fallbackHref={`/m?date=${selectedDate}`} label="Retour" size="md" />

      <header className="space-y-2">
        <h1 className="text-xl font-semibold">
          {mission?.name ?? site?.name ?? 'Intervention'}
        </h1>
        {site && (
          <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div>{site.name}</div>
              {site.address && <div>{site.address}</div>}
              {site.notes && (
                <div className="italic mt-1 whitespace-pre-wrap">
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
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-full border text-sm font-medium ${slotBadgeClass}`}
            title="Horaire de prestation (V6.1). Ancrage site/contrat, jamais pointage personne."
          >
            {timeLabel}
          </span>
        </div>
      </header>

      {isSkipped && (
        <div className="rounded-lg border border-l-4 border-l-[#8a3030]/60 border-border bg-muted/20 p-4 text-sm space-y-1">
          <div className="font-semibold text-foreground">
            Opération annulée pour ce jour
          </div>
          {intervention.skipped_reason && (
            <div className="text-sm text-muted-foreground">
              Raison&nbsp;: {intervention.skipped_reason}
            </div>
          )}
        </div>
      )}

      {teamHasNoChef && !isSkipped && !isCompleted && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Équipe sans chef d&apos;équipe actif</div>
            <div className="text-xs text-amber-900/80 mt-0.5">
              La clôture terrain est prévue par un chef d&apos;équipe. Préviens le gérant si besoin.
            </div>
          </div>
        </div>
      )}

      {!isSkipped && isPlanned && <StartInterventionButton interventionId={id} />}

      {isCompleted && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-base text-foreground flex items-center gap-2">
          <Check className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span>Mission {intervention.status === 'validated' ? 'validée' : 'terminée'}</span>
        </div>
      )}

      {isInProgress && (
        <div className="rounded-lg border-l-2 border-l-foreground border-y border-r border-border bg-card p-3 text-sm text-muted-foreground">
          Mission en cours — les tâches se cochent au fur et à mesure.
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

      {/* V5.1.4 — Lectures du lieu (présence périphérique discrète).
          Doctrine Vincent 2026-05-15 : toujours visible, jamais conditionnelle.
          2 fragments max, typo gris léger — c'est la mémoire qui accompagne,
          pas l'IA qui interrompt. Joseph peut l'ignorer ou s'en saisir. */}
      {siteId && enrichedSiteReadings.readings.length > 0 && (
        <MobileSiteReadings readings={enrichedSiteReadings} siteId={siteId} />
      )}

      {/* Sprint 2 — Section « À savoir pour ce site ».
          Rendu dès qu'il y a du contenu à afficher (notes OU bouton d'ajout).
          Le wrapper <section> reste stable entre « 0 notes » et « N notes » quand
          !showResumeMode, ce qui évite le remontage de AddSiteNoteButton et la
          perte de l'état optimiste `createdNotes`. */}
      {siteId && (siteNotes.length > 0 || !showResumeMode) && (
        <section aria-labelledby="site-notes-heading">
          {siteNotes.length > 0 && (
            <>
              <h2
                id="site-notes-heading"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2"
              >
                <MapPin className="h-3 w-3" />À savoir pour ce site
              </h2>
              <ul className="space-y-1.5 mb-2">
                {siteNotes.slice(0, 5).map((note) => (
                  <li key={note.id} className="text-sm leading-relaxed">
                    • {note.body}
                    <span className="text-[10px] text-muted-foreground/60 ml-2">
                      ({formatRelativeShort(note.created_at)})
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!showResumeMode && <AddSiteNoteButton siteId={siteId} />}
        </section>
      )}

      {siteRequiresHandover && (
        <AccessSection
          interventionId={id}
          events={accessEvents}
          canCapture={!isSkipped && (isPlanned || isInProgress || isAdmin)}
          needsReturnPrompt={accessReturn.pickupNeedsReturn}
        />
      )}

      <ChecklistMobile
        interventionId={id}
        items={checklistItems}
        serverPhotos={photos}
        signedUrls={signedUrls}
        canEdit={isInProgress}
      />

      <VoiceNoteList notes={voiceNotesWithUrls} />

      <AnomalyList anomalies={anomalies} canDelete={isInProgress} />

      {isInProgress && (
        <div className="space-y-3 mt-6">
          <AnomalyTrigger interventionId={id} />
          <VoiceNoteTrigger interventionId={id} />
          <CompleteButton
            interventionId={id}
            hasMissingRequired={hasMissingRequired}
          />
        </div>
      )}

      {/* Slice 6.4 — Boutons d'action quand l'intervention est encore planifiée :
          - Annuler l'opération de ce jour
          - Décaler l'intervention (si équipe affectée)
          Côte-à-côte, sobres, séparés du CTA principal. */}
      {!isSkipped && isPlanned && (
        <div className="mt-8 pt-4 border-t border-border grid grid-cols-2 gap-2">
          <SkipInterventionTrigger interventionId={id} />
          {intervention.assigned_team_id && (
            <RescheduleTriggerMobile interventionId={id} />
          )}
        </div>
      )}

      {/* V5.1 — Bouton photo sticky bas retiré : redondant avec les boutons
          photo de la checklist (1 par item) et avec le FAB Photo libre sur
          /m/site/[id] pour les traces spontanées. */}
    </div>
  )
}
