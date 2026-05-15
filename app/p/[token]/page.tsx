// Slice B.4 — Route publique /p/[token] : vérification anonyme de preuve.
// Slice E.2 — Étendue pour servir aussi les rapports mensuels client.
//
// Pourquoi cette route existe :
//   Quand le DG cleaning partage un lien à son client mécontent, le client
//   doit pouvoir cliquer SANS se connecter, voir la preuve immédiatement,
//   vérifier l'authenticité (header MemorIA + watermark), et télécharger
//   le PDF depuis cette même page. C'est aussi vers cette route que pointe
//   le QR code du PDF — un auditeur scanne, atterrit ici, voit la preuve.
//
// Doctrine impérative :
//   - Anonymisation forcée par défaut (include_identities=false). Les composants
//     ProofValidations / ProofChecklist / ProofAnomalies anonymisent déjà.
//   - Override identités (include_identities=true) ⇒ bandeau ambre informant
//     le visiteur que cette vue inclut les identités à des fins juridiques.
//   - 4 états distincts du token : 404 / révoqué / expiré / actif. Chaque
//     état a son message dédié, sobre, sans alarmisme.
//   - Audit silencieux : recordShareAccess incrémente access_count +
//     last_accessed_at. Pas de cookies, pas d'analytics tiers.
//   - Bouton "Télécharger le PDF" pointe vers /p/[token]/pdf (route publique
//     dédiée, pas la route dashboard /preuves/[id]/dossier qui exige auth).
//
// Slice E.2 — Dispatch :
//   - Si shareToken.intervention_id NOT NULL → dossier de preuves (Phase 5)
//   - Si shareToken.contract_id + report_month NOT NULL → rapport mensuel
//   La CHECK chk_token_kind garantit le XOR au niveau DB.
//
// Note technique : on utilise getShareTokenByValueRaw pour distinguer les
// trois cas d'erreur ; getShareTokenByValue retourne null pour les trois.

import {
  ShieldX,
  ShieldAlert,
  ShieldCheck,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Clock as ClockIcon,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  getShareTokenByValueRaw,
  recordShareAccess,
} from '@/lib/db/proof-share'
import { headers } from 'next/headers'
import { getProofDetail } from '@/lib/db/proofs'
import { getContractMonthlyReport } from '@/lib/db/monthly-report'
import { formatDateLong, formatDuration } from '@/lib/format'
import { ProofPhotoGrid } from '@/app/(dashboard)/preuves/[id]/ProofPhotoGrid'
import { ProofChecklist } from '@/app/(dashboard)/preuves/[id]/ProofChecklist'
import { ProofValidations } from '@/app/(dashboard)/preuves/[id]/ProofValidations'
import { ProofAnomalies } from '@/app/(dashboard)/preuves/[id]/ProofAnomalies'
import { MonthlyReportPublicView } from './MonthlyReportPublicView'
import { getContractTopReadings } from '@/lib/db/site-cockpit'
import { getProofPageReading } from '@/lib/ai/site-readings'

// Force dynamic — ne JAMAIS cacher cette page. Chaque visite doit
// re-valider le token (un revoke doit avoir effet immédiat) et incrémenter
// l'audit log.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function PublicProofPage({ params }: PageProps) {
  const { token } = await params

  const shareToken = await getShareTokenByValueRaw(token)

  // Case 1 : token introuvable.
  if (!shareToken) {
    return (
      <EmptyState
        icon={ShieldX}
        title="Ce lien n'existe pas"
        description="Ce dossier de preuves n'a pas pu être trouvé. Vérifiez le lien ou contactez la personne qui vous l'a partagé."
      />
    )
  }

  // Case 2 : token révoqué.
  if (shareToken.revoked_at) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Ce lien a été révoqué"
        description="Le partage de ce dossier de preuves a été annulé par son émetteur. Contactez-le si vous avez besoin d'y accéder à nouveau."
      />
    )
  }

  // Case 3 : token expiré.
  if (new Date(shareToken.expires_at).getTime() < Date.now()) {
    const expiredOn = new Date(shareToken.expires_at).toLocaleDateString(
      'fr-FR',
      { day: 'numeric', month: 'long', year: 'numeric' },
    )
    return (
      <EmptyState
        icon={Clock}
        title="Ce lien a expiré"
        description={`Ce dossier de preuves n'est plus accessible depuis le ${expiredOn}. Contactez l'émetteur pour obtenir un nouveau lien.`}
      />
    )
  }

  // Case 4 : token actif → on enregistre l'accès (best-effort, fire-and-forget)
  //          via la RPC atomique (migration 042). Capture IP / user-agent pour
  //          traçabilité forensique en cas de litige.
  const hdrs = await headers()
  const xff = hdrs.get('x-forwarded-for')
  const ip = xff ? xff.split(',')[0]?.trim() : (hdrs.get('x-real-ip') ?? null)
  const userAgent = hdrs.get('user-agent') ?? null
  recordShareAccess(shareToken.id, 'viewed', { ip, userAgent }).catch((e) =>
    console.warn('[public-proof] recordShareAccess failed:', e),
  )

  // ---- Slice E.2 : dispatch rapport mensuel client ---------------------
  //   Si le token est de type rapport mensuel (contract_id + report_month),
  //   on délègue à MonthlyReportPublicView. La CHECK chk_token_kind garantit
  //   le XOR au niveau DB ; on teste ici par sûreté.
  if (shareToken.contract_id && shareToken.report_month && !shareToken.intervention_id) {
    let reportData
    try {
      reportData = await getContractMonthlyReport(
        shareToken.contract_id,
        shareToken.report_month,
      )
    } catch {
      reportData = null
    }
    if (!reportData) {
      return (
        <EmptyState
          icon={ShieldX}
          title="Rapport indisponible"
          description="Le rapport mensuel associé à ce lien n'est plus accessible. Contactez l'émetteur du lien."
        />
      )
    }
    // V5.1.4 — Strophe IA du mois (Vincent 2026-05-15) : phrases factuelles
    // descriptives, plafond 3, ZÉRO titre technique côté client.
    const siteReadingTexts = await getContractTopReadings(shareToken.contract_id, 3)

    return (
      <MonthlyReportPublicView
        token={token}
        shareToken={shareToken}
        reportData={reportData}
        selectedPhotoIds={shareToken.selected_photo_ids ?? []}
        dgNote={shareToken.dg_note ?? ''}
        siteReadingTexts={siteReadingTexts}
      />
    )
  }

  // ---- Slice B.4 : dossier de preuves intervention (cas historique) ----
  if (!shareToken.intervention_id) {
    return (
      <EmptyState
        icon={ShieldX}
        title="Lien incomplet"
        description="Ce lien n'est plus exploitable. Contactez l'émetteur pour obtenir un nouveau lien."
      />
    )
  }

  const proof = await getProofDetail(shareToken.intervention_id)
  if (!proof) {
    return (
      <EmptyState
        icon={ShieldX}
        title="Données indisponibles"
        description="La preuve associée à ce lien n'est plus accessible. L'intervention a pu être supprimée."
      />
    )
  }

  const dateSource = proof.executed_at ?? proof.scheduled_at
  const dateLabel = dateSource
    ? proof.executed_at
      ? `Exécutée le ${formatDateLong(dateSource)}`
      : `Planifiée le ${formatDateLong(dateSource)}`
    : 'Sans date'

  const proofPageReading = await getProofPageReading(proof.site_id, proof.mission_name)

  const resolvedCount = proof.anomalies.filter((a) => a.resolved_at).length
  const anomaliesValue =
    proof.anomalies.length === 0
      ? 'Aucune'
      : `${proof.anomalies.length} (${resolvedCount} résolue${resolvedCount > 1 ? 's' : ''})`

  const expirationLabel = new Date(shareToken.expires_at).toLocaleDateString(
    'fr-FR',
    { day: 'numeric', month: 'long', year: 'numeric' },
  )

  return (
    <div className="space-y-6">
      {/* Bandeau identités (si override admin activé) — sinon sous-header
          sobre signalant l'anonymisation par défaut. Symétrie de l'information. */}
      {shareToken.include_identities ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Vue avec identités.</strong>{' '}
          <span>
            Ce dossier inclut les identités des intervenants à des fins
            juridiques ou contractuelles.
          </span>
        </div>
      ) : (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Identités masquées par défaut · Confidentialité préservée
        </p>
      )}

      {/* Title section */}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{proof.mission_name}</h1>
        <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {proof.site_name}
          </span>
          {proof.contract_name && (
            <>
              <span aria-hidden>·</span>
              <span>{proof.contract_name}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" aria-hidden />
            {dateLabel}
          </span>
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
              icon={ClockIcon}
              label="Durée"
              value={
                proof.duration_minutes
                  ? formatDuration(proof.duration_minutes)
                  : '—'
              }
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
            <Stat
              icon={AlertTriangle}
              label="Anomalies"
              value={anomaliesValue}
            />
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

      {/* Lecture du lieu — 1 fragment max, wording externe, sobre.
          Séparateur fin avant : le client doit "tomber dessus" après les preuves,
          pas le voir annoncé. Effet mémoire vivante. */}
      {proofPageReading && (
        <div className="border-t border-border/40 pt-5 px-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60 mb-2">
            Lecture du lieu
          </p>
          <p className="text-sm text-foreground/60 leading-relaxed">
            {proofPageReading}
          </p>
        </div>
      )}

      {/* Bouton télécharger le PDF — route publique dédiée */}
      <Card>
        <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">
              Télécharger le dossier de preuves
            </h3>
            <p className="text-xs text-muted-foreground">
              PDF horodaté avec QR de vérification.
            </p>
          </div>
          <a
            href={`/p/${token}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button>Télécharger le PDF</Button>
          </a>
        </CardContent>
      </Card>

      {/* Footnote expiration — encart léger pour donner du poids visuel
          à l'information sans alarmer le client. */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <ClockIcon className="h-3.5 w-3.5" aria-hidden />
          Lien valable jusqu&apos;au {expirationLabel}
        </div>
      </div>
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

