'use client'

// Slice 6.4 — Trigger superviseur « Pas aujourd'hui ».
//
// Réutilise la modal mobile en injectant la server action superviseur (admin /
// manager) à la place de la version mobile (chef_equipe).
// Doctrine : même wording, même comportement, même style sobre.

import { SkipInterventionTrigger } from '@/app/(field)/m/intervention/[id]/skip-modal'
import { skipInterventionSupervisorAction } from './intervention-actions'

export function SkipInterventionTriggerSupervisor({
  interventionId,
}: {
  interventionId: string
}) {
  return (
    <SkipInterventionTrigger
      interventionId={interventionId}
      action={skipInterventionSupervisorAction}
    />
  )
}
