'use client'

// Retirer un roulement. Ses rythmes s'ARRÊTENT (archivés) — les interventions
// déjà générées et leurs preuves RESTENT. Une preuve n'est jamais détruite par
// un geste de rangement.

import { RemoveButton } from '@/components/removal/RemoveButton'
import { removeCycleAction } from './actions'

export function RemoveCycleButton({ cycleId, name }: { cycleId: string; name: string }) {
  return (
    <RemoveButton
      label={name}
      consequence="Ce roulement s’arrête et sort de vos écrans. Les interventions déjà créées, et leurs preuves, restent conservées."
      onConfirm={async () => {
        const r = await removeCycleAction(cycleId)
        return 'error' in r ? { error: r.error } : { ok: true as const }
      }}
    />
  )
}
