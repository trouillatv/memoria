'use client'

// Actions compactes par ligne dans la liste documents (page index).
// Géoétage manager+ déjà appliqué au niveau page (notFound si non).
// Réutilise les mêmes Server Actions que DocumentActions (page détail).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { relaunchDocumentAnalysisAction, deleteDocumentAction } from './actions'

const IN_FLIGHT = ['pending', 'extracting', 'ocr', 'chunking']

export function DocumentRowActions({
  documentId,
  filename,
  analysisStatus,
}: {
  documentId: string
  filename: string
  analysisStatus: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const inFlight = IN_FLIGHT.includes(analysisStatus)

  function onRelaunch() {
    setErr(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      const r = await relaunchDocumentAnalysisAction(fd)
      if (r.ok) router.refresh()
      else setErr(r.error ?? 'Échec')
    })
  }

  function onDelete() {
    if (!window.confirm(
      `Supprimer « ${filename} » ?\n\n` +
      'Fichier conservé (restauration possible).\n' +
      'Analyses IA dérivées nettoyées.',
    )) return
    setErr(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      const r = await deleteDocumentAction(fd)
      if (r.ok) router.refresh()
      else setErr(r.error ?? 'Échec')
    })
  }

  return (
    <span className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={onRelaunch}
        disabled={pending || inFlight}
        title={inFlight ? 'Analyse en cours' : 'Réanalyser'}
        className="text-xs underline text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:no-underline"
      >
        Réanalyser
      </button>
      <span className="text-xs text-muted-foreground/40">·</span>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        title="Supprimer"
        className="text-xs underline text-destructive/80 hover:text-destructive disabled:opacity-50"
      >
        Supprimer
      </button>
      {err && <span className="text-xs text-destructive ml-1">{err}</span>}
    </span>
  )
}
