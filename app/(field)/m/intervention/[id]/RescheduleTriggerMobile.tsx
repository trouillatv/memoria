'use client'

import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { RescheduleDialog } from '@/components/reschedule/RescheduleDialog'
import { rescheduleInterventionMobileAction, getAvailableSlotsMobileAction } from './actions'

export function RescheduleTriggerMobile({ interventionId }: { interventionId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-sky-300 bg-sky-50 text-sm font-medium text-sky-900 px-4 py-3 hover:bg-sky-100 active:bg-sky-200/70"
        style={{ minHeight: 48 }}
      >
        <CalendarClock className="h-4 w-4" />
        Décaler l&apos;intervention
      </button>
      <RescheduleDialog
        interventionId={interventionId}
        open={open}
        onClose={() => setOpen(false)}
        fetchSlots={getAvailableSlotsMobileAction}
        reschedule={rescheduleInterventionMobileAction}
        variant="mobile"
      />
    </>
  )
}
