'use client'

import { useTransition } from 'react'
import { Check } from 'lucide-react'
import { completeDashboardAction } from './actions'

export function ActionCheckbox({ actionId, siteId, label }: { actionId: string; siteId: string; label: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      aria-label={`Clôturer ${label}`}
      disabled={pending}
      onClick={() => startTransition(() => { void completeDashboardAction(actionId, siteId) })}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#b9c5d8] bg-white text-transparent transition-colors hover:border-[#3d70d7] hover:bg-[#edf3ff] hover:text-[#3d70d7] disabled:opacity-50"
    >
      <Check className="h-4 w-4" />
    </button>
  )
}
