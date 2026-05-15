'use client'

import { useState } from 'react'
import { Mic } from 'lucide-react'
import { VoiceNoteModal } from './VoiceNoteModal'

interface Props {
  interventionId: string
}

export function VoiceNoteTrigger({ interventionId }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-medium py-4 active:bg-muted/40"
        style={{ minHeight: 64 }}
      >
        <Mic className="h-5 w-5 text-muted-foreground" />
        Ajouter une note terrain
      </button>
      <VoiceNoteModal
        interventionId={interventionId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
