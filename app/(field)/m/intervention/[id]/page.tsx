import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, MapPin, Clock } from 'lucide-react'
import {
  getIntervention,
  listChecklistItemsByIntervention,
  listPhotosByIntervention,
} from '@/lib/db/interventions'
import { getMission } from '@/lib/db/missions'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSignedPhotoUrls } from '@/lib/storage/intervention-photos'
import { ChecklistMobile } from './checklist-mobile'
import { StartInterventionButton } from './start-intervention-button'
import { AnomalyTrigger } from './anomaly-trigger'
import { CompleteButton } from './complete-button'

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

      {isPlanned && <StartInterventionButton interventionId={id} />}

      {isCompleted && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-800">
          ✓ Mission {intervention.status === 'validated' ? 'validée' : 'terminée'}
        </div>
      )}

      {isInProgress && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          Mission en cours — cochez les tâches au fur et à mesure
        </div>
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
    </div>
  )
}
