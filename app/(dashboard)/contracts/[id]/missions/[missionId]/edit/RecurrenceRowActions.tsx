'use client'

// Phase 6 — Recurrence simple — Slice 6.5
//
// Wrapper client pour les actions par ligne de recurrence : ouvre la modal en
// mode edition + delegue l'archivage au composant dedie.

import { useState } from 'react'
import { RecurrenceModal } from './RecurrenceModal'
import { ArchiveRecurrenceButton } from './ArchiveRecurrenceButton'
import type { DbInterventionTemplate } from '@/types/db'

interface RecurrenceRowActionsProps {
  template: DbInterventionTemplate
  missionId: string
  missionName: string
  /** Optionnel : le contrat n'est plus un prérequis du rythme. */
  contractId?: string
}

export function RecurrenceRowActions({
  template,
  missionId,
  missionName,
  contractId,
}: RecurrenceRowActionsProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`edit-recurrence-${template.id}`}
        className="text-xs px-2 py-1 rounded border bg-background hover:bg-muted/50"
      >
        Éditer
      </button>
      <ArchiveRecurrenceButton templateId={template.id} contractId={contractId} />

      <RecurrenceModal
        missionId={missionId}
        missionName={missionName}
        contractId={contractId}
        open={open}
        onClose={() => setOpen(false)}
        template={template}
      />
    </div>
  )
}
