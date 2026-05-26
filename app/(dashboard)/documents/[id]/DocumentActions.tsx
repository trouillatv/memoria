'use client'

// Boutons « Réanalyser » + « Supprimer » sur la page document.
// Manager+ uniquement — gating fait côté server (page.tsx conditionnement),
// le composant est inerte si pas affiché. Discipline coût IA : la
// réanalyse RE-OCR et RE-EMBED, donc geste conscient (confirm sur supprimer).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { relaunchDocumentAnalysisAction, deleteDocumentAction } from '../actions'
import { AiCostHint } from '../AiCostHint'

const IN_FLIGHT_STATUSES = ['pending', 'extracting', 'ocr', 'chunking']

export function DocumentActions({
  documentId,
  analysisStatus,
  costModel,
  costTokens,
  costEstimateUsd,
}: {
  documentId: string
  analysisStatus: string
  costModel?: string | null
  costTokens?: number | null
  costEstimateUsd?: number | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const analysisInFlight = IN_FLIGHT_STATUSES.includes(analysisStatus)

  function onRelaunch() {
    setMsg(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      const r = await relaunchDocumentAnalysisAction(fd)
      if (r.ok) {
        setMsg({ ok: true, text: 'Analyse relancée — patiente quelques instants puis rafraîchis.' })
        router.refresh()
      } else {
        setMsg({ ok: false, text: r.error ?? 'Échec' })
      }
    })
  }

  function onDelete() {
    if (!window.confirm(
      'Supprimer ce document ?\n\n' +
      'Le fichier est conservé (restauration possible).\n' +
      'Les analyses IA dérivées (chunks d\'embedding, résonances site) sont nettoyées.',
    )) return
    setMsg(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      const r = await deleteDocumentAction(fd)
      if (r.ok) {
        router.push('/documents')
      } else {
        setMsg({ ok: false, text: r.error ?? 'Échec' })
      }
    })
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="inline-flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          onClick={onRelaunch}
          disabled={pending || analysisInFlight}
          title={analysisInFlight ? 'Analyse en cours' : undefined}
        >
          {pending ? '…' : 'Réanalyser'}
        </Button>
        <AiCostHint model={costModel} tokens={costTokens} estimateUsd={costEstimateUsd} />
      </span>
      <Button
        type="button"
        variant="outline"
        onClick={onDelete}
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        {pending ? '…' : 'Supprimer'}
      </Button>
      {msg && (
        <p className={`text-sm ${msg.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
