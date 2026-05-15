// Slice S3 — Page publique de VÉRIFICATION D'AUTHENTICITÉ.
//
// Doctrine V5 Pilier 6 « Infrastructure invisible » :
//   Sylvie (cliente) ouvre cette URL depuis le QR du PDF qu'elle archive
//   3 ans plus tard. Le share_token original peut être expiré ou révoqué :
//   peu importe, ce token-ci atteste juste que le document a bien été émis
//   par {tenantName} via MemorIA à telle date.
//
// PAS de contenu affiché. PAS de PDF généré. Juste une attestation sobre.

import { ShieldCheck, ShieldX } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { getVerificationTokenByValue } from '@/lib/db/proof-verification'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MONTHS_FR_FULL = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatDateLong(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getUTCDate()} ${MONTHS_FR_FULL[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}`
}

function formatReportMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyymm
  return `${MONTHS_FR_FULL[(m ?? 1) - 1] ?? ''} ${y}`
}

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function VerificationPage({ params }: PageProps) {
  const { token } = await params
  const vt = await getVerificationTokenByValue(token)

  if (!vt) {
    return (
      <EmptyState
        icon={ShieldX}
        title="Vérification impossible"
        description="Ce code de vérification n'existe pas. Le document a peut-être été supprimé ou le code mal recopié."
      />
    )
  }

  const docKind = vt.intervention_id
    ? 'Dossier de preuves'
    : 'Rapport mensuel'
  const docDetails = vt.report_month
    ? ` du mois de ${formatReportMonth(vt.report_month)}`
    : ''
  const tenant = vt.tenant_name?.trim() || 'le prestataire'

  return (
    <div className="space-y-6">
      {/* En-tête sobre, rassurant, infrastructure invisible */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 space-y-3">
        <div className="inline-flex items-center gap-2 text-emerald-700">
          <ShieldCheck className="h-6 w-6" />
          <h1 className="text-xl font-semibold">Document authentique</h1>
        </div>
        <p className="text-sm text-emerald-900">
          Ce document <strong>{docKind}</strong>
          {docDetails && <> </>}
          {docDetails && <span>{docDetails}</span>} a été émis par <strong>{tenant}</strong>{' '}
          le <strong>{formatDateLong(vt.created_at)}</strong> via l&apos;infrastructure MemorIA.
        </p>
        <p className="text-xs text-emerald-900/80">
          Cette vérification ne montre pas le contenu du document. Pour le contenu, utilisez
          le lien de partage temporaire qui vous a été transmis par votre prestataire.
        </p>
      </div>

      <div className="rounded-md border bg-card p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">À propos de cette vérification</p>
        <p>
          MemorIA garantit que ce code de vérification a été généré automatiquement au
          moment où le document a été produit. Ce code est <strong>permanent</strong> :
          vous pouvez le revérifier dans plusieurs années même si le lien de partage
          original a expiré.
        </p>
      </div>
    </div>
  )
}
