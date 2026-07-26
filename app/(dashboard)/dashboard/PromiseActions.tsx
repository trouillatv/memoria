'use client'

// Première UI de résolution des promesses (T4). Rendue dans la carte Attention
// dès que celle-ci porte un `subject`. Chaque bouton appelle l'action serveur
// correspondante (T3) avec le SEUL subject — l'identité et l'organisation sont
// vérifiées côté serveur. Au succès, on rafraîchit : la promesse résolue passe
// en statut terminal, le read model l'exclut, le signal disparaît.
//
// Les libellés viennent du presenter (props `resolutions`) — jamais réécrits ici.
// « Marquer comme réalisée » n'est PAS « Confirmer » (réservé à la promotion).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, X, Repeat, ListPlus } from 'lucide-react'
import type { PromiseSubjectRef } from '@/lib/memory/signals/operational-contract'
import type { AttentionResolution, AttentionCard } from '@/lib/situations/attention/types'
import {
  fulfillPromiseAction, cancelPromiseAction, replacePromiseAction, createPromiseFollowUpAction,
} from './promise-resolution-actions'

type ActionResult = { ok?: true; error?: string }
// Gestes qui demandent une saisie avant exécution (motif / intitulé).
type FormKind = 'cancel_promise' | 'replace_promise' | 'create_follow_up_action'

const ICON = {
  fulfill_promise: Check, cancel_promise: X, replace_promise: Repeat, create_follow_up_action: ListPlus,
} as const

const FIELD: Record<FormKind, { placeholder: string; required: boolean }> = {
  cancel_promise: { placeholder: 'Motif (recommandé)', required: false },
  replace_promise: { placeholder: 'Formuler la nouvelle promesse', required: true },
  create_follow_up_action: { placeholder: "Intitulé de l'action de suivi", required: true },
}

export function PromiseActions({ subject, resolutions }: { subject: PromiseSubjectRef; resolutions: AttentionResolution[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [openForm, setOpenForm] = useState<FormKind | null>(null)
  const [text, setText] = useState('')

  function run(promise: Promise<ActionResult>, successMsg: string) {
    startTransition(async () => {
      const r = await promise
      if (r?.error) { toast.error(r.error); return }
      toast.success(successMsg)
      setOpenForm(null); setText('')
      router.refresh() // le signal résolu doit disparaître
    })
  }

  function trigger(kind: AttentionResolution['kind']) {
    if (kind === 'fulfill_promise') { run(fulfillPromiseAction({ subject }), 'Promesse marquée comme réalisée.'); return }
    // Les autres ouvrent leur saisie ; un second clic sur le même bouton la referme.
    setText('')
    setOpenForm((cur) => (cur === kind ? null : (kind as FormKind)))
  }

  function submitForm() {
    if (!openForm) return
    const value = text.trim()
    if (FIELD[openForm].required && value.length < 3) { toast.error('Au moins 3 caractères.'); return }
    if (openForm === 'cancel_promise') run(cancelPromiseAction({ subject, reason: value }), 'Promesse annulée.')
    else if (openForm === 'replace_promise') run(replacePromiseAction({ subject, title: value }), 'Promesse remplacée.')
    else run(createPromiseFollowUpAction({ subject, title: value }), 'Action de suivi créée.')
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {resolutions.map((r) => {
          const Icon = ICON[r.kind]
          const isFulfill = r.kind === 'fulfill_promise'
          return (
            <button
              key={r.kind}
              type="button"
              disabled={pending}
              onClick={() => trigger(r.kind)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                isFulfill
                  ? 'bg-[#127a4e] text-white hover:bg-[#0e6340]'
                  : 'border border-[#dbe2ef] bg-white text-[#33415c] hover:bg-[#f7f9fd]'
              } ${openForm === r.kind ? 'ring-2 ring-[#1463e8]/30' : ''}`}
            >
              <Icon className="h-3.5 w-3.5" /> {r.label}
            </button>
          )
        })}
      </div>

      {openForm && (
        <div className="flex flex-col gap-2 rounded-xl border border-[#e5eaf3] bg-[#fbfcff] p-2 sm:flex-row sm:items-center">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={FIELD[openForm].placeholder}
            disabled={pending}
            className="min-w-0 flex-1 rounded-lg border border-[#dbe2ef] px-2 py-1.5 text-xs"
            onKeyDown={(e) => { if (e.key === 'Enter') submitForm() }}
            autoFocus
          />
          <div className="flex gap-2">
            <button type="button" onClick={submitForm} disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg bg-[#1463e8] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0c4dbd] disabled:opacity-50">
              <Check className="h-3.5 w-3.5" /> Valider
            </button>
            <button type="button" onClick={() => { setOpenForm(null); setText('') }} disabled={pending}
              className="rounded-lg border border-[#dbe2ef] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#33415c] hover:bg-[#f7f9fd] disabled:opacity-50">
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Rend les gestes de résolution d'une carte, ou rien si elle n'est pas résoluble. */
export function AttentionCardResolutions({ card }: { card: AttentionCard }) {
  if (!card.subject || card.resolutions.length === 0) return null
  return <PromiseActions subject={card.subject} resolutions={card.resolutions} />
}
