'use client'

// Actions compactes par ligne dans la liste documents (page index).
// Géoétage manager+ déjà appliqué au niveau page (notFound si non).
// Réutilise les mêmes Server Actions que DocumentActions (page détail).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { relaunchDocumentAnalysisAction, deleteDocumentAction, moveDocumentAction } from './actions'
import { AiCostHint } from './AiCostHint'

const IN_FLIGHT = ['pending', 'extracting', 'ocr', 'chunking']

export function DocumentRowActions({
  documentId,
  filename,
  analysisStatus,
  currentCollectionId,
  collections = [],
  embedModel = null,
}: {
  documentId: string
  filename: string
  analysisStatus: string
  currentCollectionId?: string
  collections?: { id: string; name: string }[]
  embedModel?: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const inFlight = IN_FLIGHT.includes(analysisStatus)
  const otherCollections = collections.filter((c) => c.id !== currentCollectionId)

  function onMove(collectionId: string) {
    if (!collectionId) return
    setErr(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      fd.set('collection_id', collectionId)
      const r = await moveDocumentAction(fd)
      if (r.ok) router.refresh()
      else setErr(r.error ?? 'Échec')
    })
  }

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
      {(otherCollections.length > 0 || currentCollectionId) && (
        <>
          <select
            aria-label="Déplacer vers une collection"
            disabled={pending}
            defaultValue=""
            onChange={(e) => { onMove(e.target.value); e.currentTarget.value = '' }}
            className="text-xs rounded border border-input bg-background px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <option value="">Déplacer vers…</option>
            {otherCollections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            {/* Permet d'orpheliner un doc (→ « Sans collection ») sans drag-drop. */}
            {currentCollectionId && <option value="none">Sans collection</option>}
          </select>
          <span className="text-xs text-muted-foreground/40">·</span>
        </>
      )}
      <button
        type="button"
        onClick={onRelaunch}
        disabled={pending || inFlight}
        title={inFlight ? 'Analyse en cours' : 'Réanalyser'}
        className="text-xs underline text-muted-foreground transition-transform hover:text-foreground active:scale-95 disabled:opacity-50 disabled:no-underline disabled:active:scale-100"
      >
        Réanalyser
      </button>
      <AiCostHint model={embedModel} />
      <span className="text-xs text-muted-foreground/40">·</span>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        title="Supprimer"
        className="text-xs underline text-destructive/80 transition-transform hover:text-destructive active:scale-95 disabled:opacity-50 disabled:active:scale-100"
      >
        Supprimer
      </button>
      {err && <span className="text-xs text-destructive ml-1">{err}</span>}
    </span>
  )
}
