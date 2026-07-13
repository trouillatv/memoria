'use client'

// Phase 6 — Recurrence simple — Slice 6.2
//
// Wrapper client qui gere l'etat d'ouverture du modal et expose le bouton
// "+ Ajouter une recurrence". La liste des recurrences existantes est rendue
// par le server component parent (page.tsx) ; ici on ne gere que le CTA + modal.

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { RecurrenceModal } from './RecurrenceModal'

interface RecurrenceSectionProps {
  missionId: string
  missionName: string
  /** Optionnel : le contrat n'est plus un prérequis du rythme. */
  contractId?: string
}

export function RecurrenceSection({
  missionId,
  missionName,
  contractId,
}: RecurrenceSectionProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card hover:bg-muted/50 text-sm"
      >
        <Plus className="h-3.5 w-3.5" />
        Ajouter une récurrence
      </button>

      <RecurrenceModal
        missionId={missionId}
        missionName={missionName}
        contractId={contractId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
