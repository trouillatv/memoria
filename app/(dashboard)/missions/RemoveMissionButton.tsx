'use client'

// Lot D — « Retirer » une mission depuis la liste.
//
// La liste connaît les DATES d'intervention, pas leur nombre : le dialogue ne
// cite donc aucun compte (on n'invente pas un chiffre). La décision réelle —
// essai vierge supprimé vs mission retirée, preuves conservées — est prise
// côté serveur par lib/removal/policy.ts, qui compte pour de vrai.

import { RemoveButton } from '@/components/removal/RemoveButton'
import { removeMissionAction } from './actions'

export function RemoveMissionButton({
  missionId,
  missionName,
  hasHistory,
}: {
  missionId: string
  missionName: string
  /** Au moins une intervention connue (dates de la liste). */
  hasHistory: boolean
}) {
  const consequence = hasHistory
    ? 'Cette mission sort de vos écrans. Ses interventions et leurs preuves restent conservées.'
    : 'Cette mission n’a aucune intervention — elle sera supprimée définitivement.'

  return (
    <RemoveButton
      label={missionName}
      consequence={consequence}
      onConfirm={async () => {
        const r = await removeMissionAction(missionId)
        return 'error' in r ? { error: r.error } : { ok: true as const }
      }}
    />
  )
}
