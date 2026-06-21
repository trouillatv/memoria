'use client'

import { Printer } from 'lucide-react'

/** Imprimer / exporter en PDF via le navigateur (le briefing tient sur une page). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted/40 print:hidden"
    >
      <Printer className="h-4 w-4" /> Imprimer
    </button>
  )
}
