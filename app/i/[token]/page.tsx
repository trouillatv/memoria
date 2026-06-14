// Page publique /i/[token] — accès intervention sans login.
//
// Accessible à toute personne ayant reçu le lien (sous-traitant, livreur…).
// Scope strict : mission + checklist de cette intervention uniquement.
// Aucun accès au chantier complet, à l'historique, aux documents.
//
// Pattern : identique à /h/[token], isolé dans sa propre route.

export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import {
  MapPin,
  Clock,
  CheckCircle2,
  ShieldOff,
  AlertCircle,
} from 'lucide-react'
import {
  getInterventionByToken,
  recordInterventionTokenAccess,
} from '@/lib/db/intervention-tokens'
import { ValidateInterventionForm } from './ValidateInterventionForm'

const SLOT_FR: Record<string, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
}

const FR_MONTHS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]
const FR_DAYS = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.']

function formatDateShort(isoDate: string | null): string | null {
  if (!isoDate) return null
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return null
  const utc = new Date(Date.UTC(y, m - 1, d))
  return `${FR_DAYS[utc.getUTCDay()]} ${d} ${FR_MONTHS[m - 1]}`
}

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function InterventionTokenPage({ params }: PageProps) {
  const { token } = await params
  const result = await getInterventionByToken(token)

  if (!result) notFound()

  // Audit silencieux — ne bloque pas le rendu.
  if (result.state === 'active') {
    const h = await headers()
    const ua = h.get('user-agent')
    recordInterventionTokenAccess(token).catch(() => {})
    void ua
  }

  // ── États non-actifs ─────────────────────────────────────────────────────
  if (result.state === 'revoked') {
    return (
      <TokenInfoPage
        icon={<ShieldOff className="h-8 w-8 text-muted-foreground/40" />}
        title="Lien révoqué"
        message="Ce lien d'accès a été révoqué. Contactez la personne qui vous l'a envoyé."
      />
    )
  }

  if (result.state === 'expired') {
    return (
      <TokenInfoPage
        icon={<Clock className="h-8 w-8 text-muted-foreground/40" />}
        title="Lien expiré"
        message="Ce lien d'accès n'est plus valide. Demandez un nouveau lien."
      />
    )
  }

  // ── État actif ───────────────────────────────────────────────────────────
  const { token: tok, intervention } = result

  const isValidated = !!tok.validated_at
  const isClosed = ['completed', 'validated', 'skipped'].includes(intervention.status)
  const canValidate =
    !isValidated &&
    (tok.permissions as string[]).includes('validate')

  const dateLabel = formatDateShort(intervention.scheduled_for)

  return (
    <div className="min-h-screen bg-background">
      {/* En-tête mission */}
      <div className="border-b bg-card px-4 py-5 space-y-1.5">
        <span className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          MemorIA
        </span>
        <h1 className="text-xl font-semibold leading-tight">{intervention.missionName}</h1>
        <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {intervention.siteName}
        </p>
        {intervention.siteAddress && (
          <p className="text-xs text-muted-foreground pl-5">{intervention.siteAddress}</p>
        )}
        <div className="flex items-center gap-2 pt-0.5 flex-wrap">
          {dateLabel && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {dateLabel}
            </span>
          )}
          {intervention.slot && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              {SLOT_FR[intervention.slot] ?? intervention.slot}
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
        {/* Instructions / notes terrain */}
        {intervention.notes && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3.5">
            <p className="text-[10px] font-semibold text-amber-800 uppercase tracking-wider mb-1">
              Instructions
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed">{intervention.notes}</p>
          </div>
        )}

        {/* Déjà validé */}
        {isValidated && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-800">Intervention confirmée</p>
              {tok.validated_by_name && (
                <p className="text-xs text-emerald-700 mt-0.5">par {tok.validated_by_name}</p>
              )}
              {tok.validation_comment && (
                <p className="text-xs text-emerald-700 mt-1.5 italic border-l-2 border-emerald-300 pl-2">
                  {tok.validation_comment}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Intervention clôturée (sans validation via ce lien) */}
        {isClosed && !isValidated && (
          <div className="rounded-xl border bg-muted/30 p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Cette intervention est clôturée.
            </p>
          </div>
        )}

        {/* Checklist interactive + validation */}
        {canValidate && (
          <ValidateInterventionForm
            token={token}
            checklistItems={intervention.checklistItems}
          />
        )}
      </div>

      <div className="border-t px-4 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Accès limité à cette intervention ·{' '}
          <span className="font-semibold">MemorIA</span>
        </p>
      </div>
    </div>
  )
}

// ── Composant états d'erreur ──────────────────────────────────────────────

function TokenInfoPage({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode
  title: string
  message: string
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center space-y-3 max-w-xs">
        <div className="flex justify-center">{icon}</div>
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-[10px] text-muted-foreground/50 pt-2">MemorIA</p>
      </div>
    </div>
  )
}
