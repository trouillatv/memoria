'use client'

// Lot D — « Retirer » un client depuis sa fiche. La décision (bloqué si des
// chantiers actifs subsistent) est calculée côté SERVEUR par la même politique
// (lib/removal/policy.ts) ; ici on l'affiche avant le geste, et l'action la
// re-vérifie de toute façon.

import { RemoveButton } from '@/components/removal/RemoveButton'
import { removeClientAction } from '../client-actions'
import { decideClientRemoval } from '@/lib/removal/policy'

export function RemoveClientButton({
  clientId,
  clientName,
  activeSiteCount,
}: {
  clientId: string
  clientName: string
  activeSiteCount: number
}) {
  const decision = decideClientRemoval(activeSiteCount)

  return (
    <RemoveButton
      label={clientName}
      consequence={decision.allowed ? decision.consequence : ''}
      blockedReason={decision.allowed ? null : decision.reason}
      redirectTo="/clients"
      onConfirm={async () => {
        const r = await removeClientAction(clientId)
        return r.ok ? { ok: true as const } : { error: r.error }
      }}
    />
  )
}
