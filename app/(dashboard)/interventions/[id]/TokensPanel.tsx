'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, ShieldOff, Hourglass, XCircle } from 'lucide-react'
import type { InterventionToken } from '@/lib/db/intervention-tokens'
import { GenerateInterventionTokenButton } from '@/app/(dashboard)/briefing/GenerateInterventionTokenButton'
import { revokeTokenAction } from './token-revoke-action'

interface Props {
  interventionId: string
  missionName: string
  siteName: string
  tokens: InterventionToken[]
}

const FR_MONTHS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

function formatShort(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate()
  const month = FR_MONTHS[d.getMonth()] ?? ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${month} ${hh}:${mm}`
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate()
  const month = FR_MONTHS[d.getMonth()] ?? ''
  return `${day} ${month}`
}

function TokenStatusBadge({ token }: { token: InterventionToken }) {
  if (token.validated_at) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        Validé
      </span>
    )
  }
  if (token.revoked_at) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
        <ShieldOff className="h-3 w-3" />
        Révoqué
      </span>
    )
  }
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Hourglass className="h-3 w-3" />
        Expiré
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
      <Clock className="h-3 w-3" />
      En attente
    </span>
  )
}

function TokenRow({
  token,
  interventionId,
}: {
  token: InterventionToken
  interventionId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const isRevocable = !token.revoked_at && !token.validated_at

  function handleRevoke() {
    startTransition(async () => {
      await revokeTokenAction(token.id, interventionId)
      router.refresh()
    })
  }

  const isExpired =
    !token.revoked_at &&
    !token.validated_at &&
    !!token.expires_at &&
    new Date(token.expires_at) < new Date()

  return (
    <li className="rounded-md border bg-card px-3 py-2.5 space-y-1">
      <div className="flex items-start gap-2 flex-wrap">
        <TokenStatusBadge token={token} />
        <span className="text-sm font-medium">
          {token.recipient_label ?? 'Lien externe'}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {formatShort(token.created_at)}
        </span>
      </div>

      {token.accessed_at && (
        <p className="text-[10px] text-muted-foreground">
          Ouvert le {formatShort(token.accessed_at)}
          {token.access_count > 1 ? ` · ${token.access_count}×` : ''}
        </p>
      )}

      {token.validated_at && (
        <p className="text-[10px] text-emerald-700">
          ✓ Validé
          {token.validated_by_name ? ` par ${token.validated_by_name}` : ''}
          {' '}le {formatShort(token.validated_at)}
        </p>
      )}

      {token.validation_comment && (
        <p className="text-[10px] text-foreground/70 italic border-l-2 border-muted pl-2">
          {token.validation_comment}
        </p>
      )}

      {token.expires_at && !token.revoked_at && !isExpired && (
        <p className="text-[10px] text-muted-foreground">
          Expire le {formatDay(token.expires_at)}
        </p>
      )}

      {isRevocable && (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={handleRevoke}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            <XCircle className="h-3 w-3" />
            {isPending ? 'Révocation…' : 'Révoquer'}
          </button>
        </div>
      )}
    </li>
  )
}

export function TokensPanel({ interventionId, missionName, siteName, tokens }: Props) {
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Liens externes
        </h2>
      </div>
      <p className="text-xs text-muted-foreground italic">
        Envoyez un lien sécurisé à un sous-traitant, livreur ou bureau de contrôle.
        Il confirme l&apos;intervention sans compte MemorIA.
      </p>
      <GenerateInterventionTokenButton
        interventionId={interventionId}
        missionName={missionName}
        siteName={siteName}
      />
      {tokens.length > 0 && (
        <ul className="space-y-2 mt-2">
          {tokens.map((tok) => (
            <TokenRow key={tok.id} token={tok} interventionId={interventionId} />
          ))}
        </ul>
      )}
    </section>
  )
}
