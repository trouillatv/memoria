import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { ArrowLeft, Calendar, MapPin, FileSearch } from 'lucide-react'
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
import { getSignedPhotoUrlsThumb } from '@/lib/storage/intervention-photos'
import { StatusBadge } from '@/components/ui/status-badge'
import { ParticipantsPanel } from './participants-panel'
import { AssignTeamButton } from './AssignTeamButton'
import { ShareInterventionButton } from '@/components/share/ShareInterventionButton'
import { formatInterventionShareText } from '@/lib/share/format-intervention'
import { BreadcrumbPrefix, DynamicCrumb } from '@/components/layout/BreadcrumbProvider'

/** Origin absolu calculé depuis les headers (cohérent avec prepareProofDossierAction). */
async function buildAbsoluteUrl(path: string): Promise<string> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${proto}://${host}${path}`
}
import { ExecutionPanel } from './execution-panel'
import { AnomaliesPanel } from './anomalies-panel'
import { ValidationPanel } from './validation-panel'
import { SkipInterventionTriggerSupervisor } from './skip-trigger'

export default async function InterventionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const intervention = await getIntervention(id)
  if (!intervention) notFound()

  const [mission, checklistItems, photos, anomalies, validation, participants] = await Promise.all([
    getMission(intervention.mission_id),
    listChecklistItemsByIntervention(id),
    listPhotosByIntervention(id),
    listAnomaliesByIntervention(id),
    getValidationByIntervention(id),
    listParticipantsForIntervention(id),
  ])

  const supabase = createAdminClient()
  const { data: site } = mission
    ? await supabase.from('sites').select('id, name, contract_id').eq('id', mission.site_id).maybeSingle()
    : { data: null }

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
  // affectée à un AUTRE site sur le même créneau (date+slot) ?
  // Permet d'afficher "déjà sur [site]" dans le dialog et de désactiver
  // l'option — éviter le clic qui mène à une erreur server.
  type SiteLite = { name: string }
  type MissionLite = { site: SiteLite | SiteLite[] | null }
  type ConflictRow = {
    assigned_team_id: string
    mission: MissionLite | MissionLite[] | null
  }
  const teamConflicts = new Map<string, string>()
  if (intervention.slot) {
    const { data: sameSlotRows } = await supabase
      .from('interventions')
      .select(
        `assigned_team_id, mission:missions!inner(site:sites!inner(name))`,
      )
      .eq('scheduled_for', intervention.scheduled_for)
      .eq('slot', intervention.slot)
      .in('status', ['planned', 'in_progress'])
      .neq('id', intervention.id)
      .not('assigned_team_id', 'is', null)
    const pick = <T,>(v: T | T[] | null): T | null =>
      v === null ? null : Array.isArray(v) ? v[0] ?? null : v
    for (const r of (sameSlotRows ?? []) as ConflictRow[]) {
      const mission = pick(r.mission)
      const site = mission ? pick(mission.site) : null
      if (!site) continue
      // Si une équipe est déjà sur plusieurs sites (data corrompue), on
      // garde le premier — c'est suffisant pour signaler le conflit.
      if (!teamConflicts.has(r.assigned_team_id)) {
        teamConflicts.set(r.assigned_team_id, site.name)
      }
    }
  }

  const teamOptions = allTeams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    conflict: teamConflicts.has(t.id)
      ? { siteName: teamConflicts.get(t.id)! }
      : null,
  }))

  // Sign URLs for photos (variante thumb 400×400 — gain bande passante).
  const signedUrls = await getSignedPhotoUrlsThumb(photos.map((p) => p.storage_path))

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
  // Créneau nommé, jamais d'heures précises (doctrine V2).
  const SLOT_FR: Record<string, string> = {
    morning: 'matin',
    afternoon: 'après-midi',
    evening: 'soir',
  }
  // Code couleur cohérent : lever du soleil / plein jour / crépuscule.
  const SLOT_BADGE_CLASS: Record<string, string> = {
    morning: 'bg-amber-50 border-amber-200 text-amber-900',
    afternoon: 'bg-sky-50 border-sky-200 text-sky-900',
    evening: 'bg-indigo-50 border-indigo-200 text-indigo-900',
  }
  const slotLabel = intervention.slot
    ? SLOT_FR[intervention.slot] ?? intervention.slot
    : 'créneau non précisé'
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
      {/* Injection du chemin d'accès breadcrumb : Contrats > [Contrat].
          Le segment "Interventions" est déjà généré naturellement par le
          pathname /interventions/[id], pas besoin de le réinjecter. */}
      {contract && (
        <BreadcrumbPrefix
          crumbs={[
            { href: '/contracts', label: 'Contrats' },
            { href: `/contracts/${contract.id}`, label: contract.name },
          ]}
        />
      )}
      {/* Renomme l'UUID de l'URL par le nom de la mission dans le breadcrumb. */}
      {mission && <DynamicCrumb segmentId={intervention.id} label={mission.name} />}

      {site?.contract_id && (
        <Link href={`/contracts/${site.contract_id}/interventions`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Retour au contrat
        </Link>
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
            title="Créneau de l'intervention (doctrine V2 : matin/après-midi/soir)"
          >
            Créneau&nbsp;: {slotLabel}
          </span>
          {mission && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {mission.name}
            </span>
          )}
        </div>
      </header>

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

      <ValidationPanel
        interventionId={intervention.id}
        status={intervention.status}
        existingValidation={validation}
      />

      {intervention.notes && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-2">Notes</h2>
          <p className="text-sm whitespace-pre-wrap">{intervention.notes}</p>
        </section>
      )}

      {/* Slice 6.4 — Bouton « Pas aujourd'hui » uniquement si planifiée
          (pas commencée, pas terminée, pas déjà sautée). Style sobre, fin de
          page, sous les actions principales. */}
      {!isSkipped && isPlanned && (
        <div className="pt-2 max-w-sm">
          <SkipInterventionTriggerSupervisor interventionId={intervention.id} />
        </div>
      )}
    </div>
  )
}
