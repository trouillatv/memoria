'use client'

// Boutons de verdict du Plan de visite (Lot B) — vocabulaire métier par
// source_kind (Levée/Fait/Appliquée/Satisfaite/Photographié…), jamais le
// triplet générique Conforme/Toujours ouvert/Sans objet. Un verdict qui mute
// réellement la source (tout sauf « sans objet pour cette visite » et le
// constat de proof_window_closing) l'annonce avant le clic ; Fait et Ne plus
// suivre sur une action exigent un commentaire réel avant tout envoi.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  type PlanVisiteVerdict,
  type PlanVisiteVerdictOption,
  planVisiteVerdictRequiresComment,
} from '@/lib/visits/plan-visite-verdict'

const SOURCE_EFFECT_LABEL: Record<string, string> = {
  reserve_open: 'Met à jour la réserve correspondante.',
  action_overdue: "Met à jour l'action correspondante.",
  decision_unapplied: 'Met à jour la décision correspondante.',
  obligation_neglected: "Met à jour l'obligation correspondante.",
  proof_window_closing: 'Constat uniquement — aucun objet modifié.',
}

export interface PlanVisiteVerdictButtonsProps {
  sourceKind: string
  options: readonly PlanVisiteVerdictOption[]
  activeVerdict?: PlanVisiteVerdict | null
  onSubmit: (verdict: PlanVisiteVerdict, comment: string | null) => Promise<{ ok: true } | { ok: false; error: string }>
  onSuccess?: (verdict: PlanVisiteVerdict) => void
  onError?: (message: string) => void
}

export function PlanVisiteVerdictButtons({
  sourceKind, options, activeVerdict, onSubmit, onSuccess, onError,
}: PlanVisiteVerdictButtonsProps) {
  const [pendingComment, setPendingComment] = useState<PlanVisiteVerdict | null>(null)
  const [commentText, setCommentText] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(verdict: PlanVisiteVerdict, comment: string | null) {
    setBusy(true)
    try {
      const r = await onSubmit(verdict, comment)
      if (r.ok) {
        setPendingComment(null)
        setCommentText('')
        onSuccess?.(verdict)
      } else {
        onError?.(r.error)
      }
    } finally {
      setBusy(false)
    }
  }

  function handleClick(verdict: PlanVisiteVerdict) {
    if (planVisiteVerdictRequiresComment(sourceKind, verdict)) {
      setPendingComment(verdict)
      setCommentText('')
      return
    }
    submit(verdict, null)
  }

  const effect = SOURCE_EFFECT_LABEL[sourceKind]

  if (pendingComment) {
    const option = options.find((o) => o.verdict === pendingComment)
    return (
      <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2">
        <p className="text-[12px] font-medium">{option?.label} — un commentaire réel est requis.</p>
        {effect && <p className="text-[11px] text-muted-foreground">{effect}</p>}
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Que s'est-il passé ?"
          maxLength={500}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => { setPendingComment(null); setCommentText('') }}
            className="rounded-lg border px-2 py-1.5 text-xs font-medium active:scale-[0.98] disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={busy || !commentText.trim()}
            onClick={() => submit(pendingComment, commentText.trim())}
            className="rounded-lg bg-foreground px-2 py-1.5 text-xs font-semibold text-white active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Confirmer'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.verdict}
            type="button"
            disabled={busy}
            onClick={() => handleClick(o.verdict)}
            className={`rounded-lg border px-1 py-2 text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-40 ${
              activeVerdict === o.verdict ? 'border-foreground bg-foreground text-white' : 'border-border bg-background text-muted-foreground'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {effect && <p className="text-[10.5px] text-muted-foreground">{effect}</p>}
    </div>
  )
}
