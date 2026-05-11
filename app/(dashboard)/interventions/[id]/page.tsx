import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar, MapPin, FileSearch } from 'lucide-react'
import {
  getIntervention,
  listChecklistItemsByIntervention,
  listPhotosByIntervention,
  listAnomaliesByIntervention,
  getValidationByIntervention,
} from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSignedPhotoUrls } from '@/lib/storage/intervention-photos'
import { StatusBadge } from '@/components/ui/status-badge'
import { ExecutionPanel } from './execution-panel'
import { AnomaliesPanel } from './anomalies-panel'
import { ValidationPanel } from './validation-panel'
import { SkipInterventionTriggerSupervisor } from './skip-trigger'

export default async function InterventionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const intervention = await getIntervention(id)
  if (!intervention) notFound()

  const [mission, checklistItems, photos, anomalies, validation] = await Promise.all([
    getMission(intervention.mission_id),
    listChecklistItemsByIntervention(id),
    listPhotosByIntervention(id),
    listAnomaliesByIntervention(id),
    getValidationByIntervention(id),
  ])

  const supabase = createAdminClient()
  const { data: site } = mission
    ? await supabase.from('sites').select('id, name, contract_id').eq('id', mission.site_id).maybeSingle()
    : { data: null }

  // Sign URLs for photos
  const signedUrls = await getSignedPhotoUrls(photos.map((p) => p.storage_path))

  const scheduledDate = new Date(intervention.scheduled_at)
  const dateLabel = scheduledDate.toLocaleDateString('fr-FR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
  const timeLabel = scheduledDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

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
      {site?.contract_id && (
        <Link href={`/contracts/${site.contract_id}/interventions`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Retour au contrat
        </Link>
      )}

      <header className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">{mission?.name ?? 'Intervention'}</h1>
          <StatusBadge status={intervention.status} size="md" />
          {showProofLink && (
            <Link
              href={`/preuves/${intervention.id}`}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <FileSearch className="h-3.5 w-3.5" />
              Voir dans Dossier de preuves
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {dateLabel} · {timeLabel}
          </span>
          {site && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {site.name}
            </span>
          )}
        </div>
      </header>

      {/* Slice 6.4 — Panneau « Pas aujourd'hui » : visible si skipped, masque
          les actions d'exécution. Sinon : bouton sobre côté action si planned. */}
      {isSkipped && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-1">
          <div className="text-sm font-semibold text-amber-900">
            Intervention marquée « pas aujourd&apos;hui »
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
