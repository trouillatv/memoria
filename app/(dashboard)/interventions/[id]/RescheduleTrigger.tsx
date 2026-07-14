'use client'

// Replanification (fiche intervention, desktop manager/admin) — UNIFIÉE avec la
// grille Semaine : on réutilise EditInterventionTimeDialog (jour + heure début/
// fin obligatoires, contrôle de conflit). Fin du picker de créneau matin/AM/soir.

import { CalendarClock } from 'lucide-react'
import { EditInterventionTimeDialog } from '@/app/(dashboard)/(planning)/semaine/EditInterventionTimeDialog'

export function RescheduleTrigger({
  interventionId,
  initialDate,
  initialStartHHMM,
  initialEndHHMM,
}: {
  interventionId: string
  initialDate: string
  initialStartHHMM: string
  initialEndHHMM: string
}) {
  return (
    <EditInterventionTimeDialog
      interventionId={interventionId}
      initialDate={initialDate}
      initialStartHHMM={initialStartHHMM}
      initialEndHHMM={initialEndHHMM}
      trigger={
        <button
          type="button"
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-sky-300 bg-sky-50 text-sm font-medium text-sky-900 px-4 py-3 hover:bg-sky-100 active:bg-sky-200/70"
          style={{ minHeight: 48 }}
        >
          <CalendarClock className="h-4 w-4" />
          Décaler l&apos;intervention
        </button>
      }
    />
  )
}
