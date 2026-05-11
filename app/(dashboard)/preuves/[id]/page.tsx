// Slice B.1 — /preuves/[id] : page détail du Dossier de preuves.
//
// Doctrine impérative :
//   - Anonymisation par défaut. Aucun prénom/nom d'agent. team_size en
//     compteur ("3 personnes"), validations en rôle ("Équipe superviseur").
//   - Calme : couleurs sobres. Anomalies en ambre — JAMAIS de rouge alarmant.
//   - Sobriété B2B. Pas de score, pas de "performance", pas de "tracking".
//   - Charge utile rapide : photos thumbnails d'abord, modal simple au click.
//     La vraie lightbox (navigation, captions, etc.) arrive en B.2.
//   - Le bouton "Préparer le dossier (PDF)" est présent mais disabled — placeholder
//     pour B.3. Cohérence visuelle dès maintenant, action plus tard.

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft,
  MapPin,
  Clock,
  Users,
  CheckCircle2,
  AlertTriangle,
  Calendar,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getProofDetail } from '@/lib/db/proofs'
import { ProofPhotoGrid } from './ProofPhotoGrid'
import { ProofChecklist } from './ProofChecklist'
import { ProofValidations } from './ProofValidations'
import { ProofAnomalies } from './ProofAnomalies'
import { PrepareDossierButton } from './PrepareDossierButton'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProofDetailPage({ params }: PageProps) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const proof = await getProofDetail(id)
  if (!proof) notFound()

  const dateSource = proof.executed_at ?? proof.scheduled_at
  const dateLabel = dateSource
    ? (proof.executed_at
        ? `Exécutée le ${formatDateLong(dateSource)}`
        : `Planifiée le ${formatDateLong(dateSource)}`)
    : 'Sans date'

  const resolvedCount = proof.anomalies.filter((a) => a.resolved_at).length
  const anomaliesValue =
    proof.anomalies.length === 0
      ? 'Aucune'
      : `${proof.anomalies.length} (${resolvedCount} résolue${resolvedCount > 1 ? 's' : ''})`

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Retour */}
      <Link
        href="/preuves"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        Retour au Dossier de preuves
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{proof.mission_name}</h1>
            <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {proof.site_name}
              </span>
              {proof.contract_name && (
                <>
                  <span aria-hidden>·</span>
                  <span>{proof.contract_name}</span>
                </>
              )}
              {proof.client_name && (
                <>
                  <span aria-hidden>·</span>
                  <span>{proof.client_name}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {dateLabel}
              </span>
            </div>
          </div>
          <StatusBadge
            status={proof.skipped_at ? 'skipped' : proof.status}
            size="md"
            className="shrink-0"
          />
        </div>

        {proof.skipped_at && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>Intervention non effectuée ce jour-là.</strong>{' '}
            <span className="italic">
              Raison&nbsp;: {proof.skipped_reason ?? 'non précisée'}
            </span>
          </div>
        )}
      </div>

      {/* Meta band : 4 stats sobres */}
      <Card>
        <CardContent className="py-3">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat
              icon={Clock}
              label="Durée"
              value={proof.duration_minutes ? formatDuration(proof.duration_minutes) : '—'}
            />
            <Stat
              icon={Users}
              label="Équipe terrain"
              value={
                proof.team_size > 0
                  ? `${proof.team_size} personne${proof.team_size > 1 ? 's' : ''}`
                  : '—'
              }
            />
            <Stat
              icon={CheckCircle2}
              label="Validations"
              value={String(proof.validations.length)}
            />
            <Stat icon={AlertTriangle} label="Anomalies" value={anomaliesValue} />
          </dl>
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Photos prises ({proof.photos.length})
          </CardTitle>
          <CardDescription>
            Les preuves visuelles capturées lors de l&apos;intervention.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {proof.photos.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Aucune photo capturée pour cette intervention.
            </p>
          ) : (
            <ProofPhotoGrid photos={proof.photos} />
          )}
        </CardContent>
      </Card>

      {/* Checklist */}
      {proof.checklist.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Étapes réalisées</CardTitle>
            <CardDescription>
              Suivi étape par étape de l&apos;intervention sur place.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProofChecklist items={proof.checklist} />
          </CardContent>
        </Card>
      )}

      {/* Validations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validations</CardTitle>
          <CardDescription>
            Contrôles de conformité enregistrés côté supervision.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProofValidations validations={proof.validations} />
        </CardContent>
      </Card>

      {/* Anomalies */}
      {proof.anomalies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Anomalies signalées</CardTitle>
            <CardDescription>
              Faits constatés sur place, résolus ou en cours de traitement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProofAnomalies anomalies={proof.anomalies} />
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {proof.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{proof.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Action principale — Slice B.3 : dossier prêt en 2 minutes. */}
      <Card>
        <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Préparer un dossier de preuves</h3>
            <p className="text-xs text-muted-foreground">
              PDF horodaté + QR de vérification + lien public temporaire.
              Anonymisation par défaut.
            </p>
          </div>
          <PrepareDossierButton interventionId={proof.id} />
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5" />
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium">{value}</dd>
      </div>
    </div>
  )
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}
