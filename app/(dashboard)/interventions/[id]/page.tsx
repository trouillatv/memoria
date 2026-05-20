import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { Calendar, MapPin, FileSearch } from 'lucide-react'
import {
  getIntervention,
  listChecklistItemsByIntervention,
  listPhotosByIntervention,
  listAnomaliesByIntervention,
  getValidationByIntervention,
} from '@/lib/db/interventions'
import { listParticipantsForIntervention } from '@/lib/db/intervention-participants'
import { getMission } from '@/lib/db/missions'
import { listTeams } from '@/lib/db/teams'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatInterventionTimeLabel, isPlannedStartPrecise } from '@/lib/time/prestation-slot'
import { listTeamConflictsForSlot } from '@/lib/scheduling/team-conflict'
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'
import { getSignedVoiceNoteUrls } from '@/lib/storage/intervention-voice-notes'
import { listValidatedVoiceNotesByIntervention } from '@/lib/db/intervention-voice-notes'
import { VoiceNotesSection } from './VoiceNotesSection'
import type { VoiceNoteDisplay } from './VoiceNotesSection'
import { StatusBadge } from '@/components/ui/status-badge'
import { ParticipantsPanel } from './participants-panel'
import { AssignTeamButton } from './AssignTeamButton'
import { ShareInterventionButton } from '@/components/share/ShareInterventionButton'
import { formatInterventionShareText } from '@/lib/share/format-intervention'
import { BreadcrumbPrefix, DynamicCrumb } from '@/components/layout/BreadcrumbProvider'
import { generateSiteReadings } from '@/lib/ai/site-readings'
import { ReadingCard } from '@/components/ui/reading-card'
import { resolveDocNamesFromFragments } from '@/lib/documents/resolve-doc-names'

/** Origin absolu calculé depuis les headers (cohérent avec prepareProofDossierAction). */
async function buildAbsoluteUrl(path: string): Promise<string> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${proto}://${host}${path}`
}
import { ExecutionPanel } from './execution-panel'
import { AnomaliesPanel } from './anomalies-panel'
import { AccessPanel } from './access-panel'
import {
  listAccessEventsByIntervention,
  getSiteRequiresAccessHandover,
} from '@/lib/db/intervention-access-events'
import { ValidationPanel } from './validation-panel'
import { SkipInterventionTriggerSupervisor } from './skip-trigger'
import { RescheduleTrigger } from './RescheduleTrigger'
import { SmartBackLink } from '@/components/nav/SmartBackLink'

export default async function InterventionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const intervention = await getIntervention(id)
  if (!intervention) notFound()

  const [mission, checklistItems, photos, anomalies, validation, participants, voiceNotes, accessEvents] = await Promise.all([
    getMission(intervention.mission_id),
    listChecklistItemsByIntervention(id),
    listPhotosByIntervention(id),
    listAnomaliesByIntervention(id),
    getValidationByIntervention(id),
    listParticipantsForIntervention(id),
    listValidatedVoiceNotesByIntervention(id),
    listAccessEventsByIntervention(id),
  ])

  const supabase = createAdminClient()
  const { data: site } = mission
    ? await supabase.from('sites').select('id, name, contract_id').eq('id', mission.site_id).maybeSingle()
    : { data: null }

  // Le bloc accès n'apparaît que sur les sites flaggés (ou s'il a déjà des
  // mouvements documentés — robustesse si le flag change après coup).
  const siteRequiresHandover = mission
    ? await getSiteRequiresAccessHandover(mission.site_id)
    : false

  // Équipe affectée à l'intervention (organisation prévue, doctrine V3) — distincte
  // des participants confirmés (réalité contextuelle).
  const { data: assignedTeam } = intervention.assigned_team_id
    ? await supabase
        .from('teams')
        .select('id, name, color')
        .eq('id', intervention.assigned_team_id)
        .maybeSingle()
    : { data: null }

  // Contract pour breadcrumb (chemin Contrats > X > Interventions).
  const { data: contract } = site?.contract_id
    ? await supabase
        .from('contracts')
        .select('id, name')
        .eq('id', site.contract_id)
        .maybeSingle()
    : { data: null }

  // Liste des équipes pour le bouton Affecter/Réassigner (visible tant que
  // l'intervention est planned — immuabilité preuve après).
  const allTeams = await listTeams()

  // Pré-calcul des conflits par équipe : pour chaque équipe, est-elle déjà
  // affectée à un AUTRE site sur des horaires qui CHEVAUCHENT ceux de cette
  // intervention ? Permet d'afficher "déjà sur [site]" dans le dialog et de
  // désactiver l'option — éviter le clic qui mène à une erreur server.
  // V6.1 : on compare par chevauchement horaire si planned_start/end dispo,
  // sinon fallback au critère slot grossier (cf. lib/scheduling/team-conflict).
  const teamConflicts = await listTeamConflictsForSlot({
    admin: supabase,
    scheduledFor: intervention.scheduled_for ?? '',
    slot: intervention.slot,
    sourcePlannedStart: intervention.planned_start,
    sourcePlannedEnd: intervention.planned_end,
    excludeInterventionId: intervention.id,
    sourceSiteId: site?.id ?? null,
  })

  // Détecter les équipes sans chef_equipe actif parmi leurs membres
  const allTeamIds = allTeams.map((t) => t.id)
  const teamsWithChef = new Set<string>()
  if (allTeamIds.length > 0) {
    type MemberRow = { team_id: string; user: { role: string } | Array<{ role: string }> | null }
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id, user:users(role)')
      .in('team_id', allTeamIds)
      .is('left_at', null)
    for (const m of (memberships ?? []) as MemberRow[]) {
      const u = Array.isArray(m.user) ? m.user[0] : m.user
      if (u?.role === 'chef_equipe') teamsWithChef.add(m.team_id)
    }
  }

  const teamOptions = allTeams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    conflict: teamConflicts.has(t.id)
      ? { siteName: teamConflicts.get(t.id)! }
      : null,
    noChef: !teamsWithChef.has(t.id),
  }))

  // Sign URLs for photos (variante thumb 400×400 — gain bande passante).
  // Lecture du lieu en parallèle — signal mnémonique, jamais bloquant.
  const [signedUrls, siteReadings] = await Promise.all([
    getSignedPhotoUrlsThumb(photos.map((p) => p.storage_path)),
    site ? generateSiteReadings((site as { id: string }).id) : Promise.resolve([]),
  ])
  // Résolution centralisée des [doc:UUID] cités dans les fragments.
  const siteReadingsDocNames = siteReadings.length > 0
    ? await resolveDocNamesFromFragments(siteReadings.map((r) => r.fragment))
    : {}

  // URLs signées pour les artefacts audio (1h TTL, bucket privé).
  const voiceNoteUrlMap = await getSignedVoiceNoteUrls(voiceNotes.map((n) => n.storage_path))
  const voiceNoteDisplays: VoiceNoteDisplay[] = voiceNotes.map((n) => ({
    id: n.id,
    signedUrl: voiceNoteUrlMap.get(n.storage_path) ?? null,
    duration_seconds: n.duration_seconds,
    transcription_corrected: n.transcription_corrected,
    fragment_validated: n.fragment_validated,
    author_name: n.author_name,
    recorded_at: n.recorded_at,
    validated_at: n.validated_at,
  }))

  // On formatte la date depuis scheduled_for (date logique) plutôt que
  // scheduled_at (timestamp UTC) — évite les décalages de fuseau qui
  // affichaient parfois "vendredi 15 mai" pour scheduled_for=14.
  const dateLabel = (() => {
    if (!intervention.scheduled_for) return 'Date non précisée'
    const [y, m, d] = intervention.scheduled_for.split('-').map(Number)
    if (!y || !m || !d) return intervention.scheduled_for
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
  })()
  // V6.1 (Vincent 2026-05-20 — demande Guillaume) : afficher TOUJOURS le
  // créneau (repère visuel + couleur badge) PLUS l'heure précise quand elle
  // est saisie. Ex : « Créneau : matin · 6h30 – 8h (1h30) ».
  // Le badge couleur reste basé sur le slot pour identité visuelle stable.
  const SLOT_FR_SHORT: Record<string, string> = {
    morning: 'matin',
    afternoon: 'après-midi',
    evening: 'soir',
  }
  const SLOT_BADGE_CLASS: Record<string, string> = {
    morning: 'bg-amber-50 border-amber-200 text-amber-900',
    afternoon: 'bg-sky-50 border-sky-200 text-sky-900',
    evening: 'bg-indigo-50 border-indigo-200 text-indigo-900',
  }
  const slotShortLabel = intervention.slot
    ? SLOT_FR_SHORT[intervention.slot] ?? intervention.slot
    : 'créneau non précisé'
  // Heure précise = planned_start non canonique OU planned_end présent
  // (saisie utilisateur dans les deux cas).
  const hasPreciseHour =
    !!intervention.planned_end ||
    isPlannedStartPrecise(intervention.planned_start)
  const preciseLabel = hasPreciseHour
    ? formatInterventionTimeLabel({
        planned_start: intervention.planned_start,
        planned_end: intervention.planned_end,
        slot: intervention.slot,
      })
    : null
  const slotBadgeClass = intervention.slot
    ? SLOT_BADGE_CLASS[intervention.slot] ?? 'bg-muted/30 border-border text-foreground'
    : 'bg-muted/30 border-border text-foreground'

  // Anomalies + validation are useable only when intervention is active enough
  const anomaliesCanCreate = intervention.status === 'in_progress' || intervention.status === 'completed'

  // Slice 6.4 — État « Pas aujourd'hui »
  const isSkipped =
    intervention.status === 'skipped' || intervention.skipped_at !== null
  const isPlanned = intervention.status === 'planned'

  // Slice B.5 — Raccourci vers le Dossier de preuves. Sobre, à droite du header.
  // On le propose dès que la preuve a un intérêt : exécutée/validée/sautée,
  // OU une trace existe déjà (photo, anomalie, validation).
  const hasAnyTrace =
    photos.length > 0 || anomalies.length > 0 || validation !== null
  const showProofLink =
    intervention.status === 'completed' ||
    intervention.status === 'validated' ||
    isSkipped ||
    hasAnyTrace

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Breadcrumb : Sites > [Site] > [Mission] quand le site est connu. */}
      {site ? (
        <BreadcrumbPrefix
          crumbs={[
            { href: '/sites', label: 'Sites' },
            { href: `/sites/${site.id}`, label: site.name },
          ]}
        />
      ) : contract ? (
        <BreadcrumbPrefix
          crumbs={[
            { href: '/contracts', label: 'Contrats' },
            { href: `/contracts/${contract.id}`, label: contract.name },
          ]}
        />
      ) : null}
      {/* Renomme l'UUID de l'URL par le nom de la mission dans le breadcrumb. */}
      {mission && <DynamicCrumb segmentId={intervention.id} label={mission.name} />}

      {site ? (
        <SmartBackLink fallbackHref={`/sites/${site.id}`} label="Retour" />
      ) : contract ? (
        <SmartBackLink fallbackHref={`/contracts/${contract.id}/interventions`} label="Retour" />
      ) : (
        <SmartBackLink fallbackHref="/aujourdhui" label="Retour" />
      )}

      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">{site?.name ?? 'Intervention'}</h1>
          <StatusBadge status={intervention.status} size="md" />
          {/* M1 — Bouton "Partager" (WhatsApp, email, etc.). Côté droit. */}
          <div className="ml-auto inline-flex items-center gap-3">
            <ShareInterventionButton
              text={formatInterventionShareText({
                missionName: mission?.name ?? 'Intervention',
                siteName: site?.name ?? '',
                scheduledFor: intervention.scheduled_for ?? intervention.scheduled_at.slice(0, 10),
                slot: intervention.slot,
              })}
              url={await buildAbsoluteUrl(`/interventions/${intervention.id}`)}
              variant="inline"
            />
            {showProofLink && (
              <Link
                href={`/preuves/${intervention.id}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <FileSearch className="h-3.5 w-3.5" />
                Voir dans Dossier de preuves
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {dateLabel}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${slotBadgeClass}`}
            title={preciseLabel
              ? "Créneau + heure de prestation saisie (V6.1). Ancrage site/contrat, jamais pointage personne."
              : "Créneau de l'intervention (matin/après-midi/soir)."}
          >
            Créneau : {slotShortLabel}
            {preciseLabel && <span className="font-semibold"> · {preciseLabel}</span>}
          </span>
          {mission && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {mission.name}
            </span>
          )}
        </div>
      </header>

      {/* Lecture du lieu — signal mnémonique (absence, résonance, persistance).
          Jamais de verdict, jamais de recommandation. Visible uniquement si signal. */}
      {siteReadings.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-reading-label/65">
            Ce que le lieu dit
          </div>
          {siteReadings.map((r, i) => (
            <ReadingCard key={i} fragment={r.fragment} compact docNames={siteReadingsDocNames} />
          ))}
        </div>
      )}

      <ParticipantsPanel
        assignedTeam={assignedTeam ? { name: assignedTeam.name, color: assignedTeam.color } : null}
        participants={participants}
      />
      {/* Bouton Affecter / Réassigner équipe — visible tant que l'intervention
          est planned. Au-delà, l'équipe est figée (immuabilité preuve). */}
      {isPlanned && (
        <div className="flex justify-end -mt-2">
          <AssignTeamButton
            interventionId={intervention.id}
            interventionLabel={mission?.name ?? 'Intervention'}
            currentTeamId={intervention.assigned_team_id}
            teams={teamOptions}
          />
        </div>
      )}

      {/* Slice 6.4 — Panneau « Pas aujourd'hui » : visible si skipped, masque
          les actions d'exécution. Sinon : bouton sobre côté action si planned. */}
      {isSkipped && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-1">
          <div className="text-sm font-semibold text-amber-900">
            Opération annulée pour ce jour
          </div>
          {intervention.skipped_reason && (
            <div className="text-sm text-amber-900/90">
              Raison&nbsp;: {intervention.skipped_reason}
            </div>
          )}
        </section>
      )}

      <ExecutionPanel
        intervention={intervention}
        checklistItems={checklistItems}
        photos={photos}
        signedUrls={Object.fromEntries(signedUrls)}
      />

      <AnomaliesPanel
        interventionId={intervention.id}
        anomalies={anomalies}
        canCreate={anomaliesCanCreate}
      />

      {(siteRequiresHandover || accessEvents.length > 0) && (
        <AccessPanel
          events={accessEvents}
          photos={photos}
          signedUrls={Object.fromEntries(signedUrls)}
        />
      )}

      <ValidationPanel
        interventionId={intervention.id}
        status={intervention.status}
        existingValidation={validation}
      />

      <VoiceNotesSection notes={voiceNoteDisplays} />

      {intervention.notes && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">Notes</h2>
          <p className="text-sm whitespace-pre-wrap">{intervention.notes}</p>
        </section>
      )}

      {/* Slice 6.4 — Boutons d'action quand l'intervention est encore planifiée :
          - Annuler l'opération de ce jour (skip)
          - Décaler l'intervention (reschedule, si équipe affectée)
          Style sobre, côte-à-côte, fin de page. */}
      {!isSkipped && isPlanned && (
        <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl">
          <SkipInterventionTriggerSupervisor interventionId={intervention.id} />
          {intervention.assigned_team_id && (
            <RescheduleTrigger interventionId={intervention.id} />
          )}
        </div>
      )}
    </div>
  )
}
