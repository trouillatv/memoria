'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { setTenderOutcomeAction } from './outcome-actions'
import type { TenderOutcome, TenderOutcomeTag } from '@/types/db'

/**
 * Doctrine V5 — verrou V1 (mémoire neutre, pas de recommandation) + verrou V4
 * (pas de formulation de contrôle humain) appliqués au wording.
 *
 * Le système enregistre ce que Patrick déclare. Il ne lui suggère aucune action
 * future, aucune injonction, aucun verbe commercial.
 */

interface OutcomeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenderId: string
  initialOutcome?: TenderOutcome | null
  initialReason?: string | null
  initialTag?: TenderOutcomeTag | null
}

const OUTCOME_OPTIONS: { value: TenderOutcome; label: string }[] = [
  { value: 'won', label: 'Gagné' },
  { value: 'lost', label: 'Perdu' },
  { value: 'withdrawn', label: 'Retiré' },
  { value: 'not_responded', label: 'Pas de réponse client' },
]

const TAG_OPTIONS: { value: TenderOutcomeTag; label: string }[] = [
  { value: 'prix', label: 'Prix' },
  { value: 'qualite', label: 'Qualité' },
  { value: 'relation', label: 'Relation' },
  { value: 'timing', label: 'Timing' },
  { value: 'autre', label: 'Autre' },
]

const MAX_REASON_LEN = 200

export function OutcomeDialog({
  open,
  onOpenChange,
  tenderId,
  initialOutcome,
  initialReason,
  initialTag,
}: OutcomeDialogProps) {
  const [outcome, setOutcome] = useState<TenderOutcome | null>(
    initialOutcome && initialOutcome !== 'pending' ? initialOutcome : null,
  )
  const [reason, setReason] = useState<string>(initialReason ?? '')
  const [tag, setTag] = useState<TenderOutcomeTag | null>(initialTag ?? null)
  const [isPending, startTransition] = useTransition()

  const showLostFields = outcome === 'lost'
  const canSubmit = outcome !== null && !isPending

  function handleReasonChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value.slice(0, MAX_REASON_LEN)
    setReason(v)
  }

  function handleSubmit() {
    if (!outcome) return

    const payload: {
      tenderId: string
      outcome: TenderOutcome
      reason?: string
      tag?: TenderOutcomeTag
    } = {
      tenderId,
      outcome,
    }
    const trimmed = reason.trim()
    if (trimmed.length > 0) payload.reason = trimmed
    if (tag) payload.tag = tag

    startTransition(async () => {
      const r = await setTenderOutcomeAction(payload)
      if (!r.ok) {
        toast.error(r.error ?? 'Échec de l\'enregistrement')
        return
      }
      toast.success('Résultat enregistré')
      onOpenChange(false)
    })
  }

  function handleCancel() {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-slot="outcome-dialog"
      >
        <DialogHeader>
          <DialogTitle>Résultat de l&apos;appel d&apos;offres</DialogTitle>
          <DialogDescription>
            En 1 clic. Cette information reste interne.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2" data-slot="outcome-radios">
          <legend className="text-sm font-medium mb-1">Statut</legend>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOME_OPTIONS.map((opt) => {
              const checked = outcome === opt.value
              return (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    checked
                      ? 'border-foreground bg-muted/50'
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="outcome"
                    value={opt.value}
                    checked={checked}
                    onChange={() => setOutcome(opt.value)}
                    className="size-4"
                  />
                  <span>{opt.label}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {showLostFields && (
          <div className="space-y-3 border-t pt-3" data-slot="outcome-lost-fields">
            <div className="space-y-1.5">
              <Label htmlFor="outcome-reason" className="text-sm font-medium">
                Raison principale
              </Label>
              <Textarea
                id="outcome-reason"
                value={reason}
                onChange={handleReasonChange}
                maxLength={MAX_REASON_LEN}
                rows={2}
                placeholder="En 1-2 phrases, qu'est-ce qui a pesé ?"
                className="resize-none text-sm"
              />
              <div className="text-xs text-muted-foreground text-right">
                {reason.length}/{MAX_REASON_LEN}
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-1">Thème</legend>
              <div className="flex flex-wrap gap-2">
                {TAG_OPTIONS.map((t) => {
                  const checked = tag === t.value
                  return (
                    <label
                      key={t.value}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors ${
                        checked
                          ? 'border-foreground bg-muted/50'
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name="outcome-tag"
                        value={t.value}
                        checked={checked}
                        onChange={() => setTag(t.value)}
                        className="size-3"
                      />
                      <span>{t.label}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isPending}
            type="button"
          >
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            type="button"
          >
            {isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =================================
// Badge sobre — affichage post-marquage
// =================================

interface OutcomeBadgeProps {
  outcome: TenderOutcome
  tag: TenderOutcomeTag | null
}

const TAG_LABEL: Record<TenderOutcomeTag, string> = {
  prix: 'prix',
  qualite: 'qualité',
  relation: 'relation',
  timing: 'timing',
  autre: 'autre',
}

export function OutcomeBadge({ outcome, tag }: OutcomeBadgeProps) {
  if (outcome === 'pending') {
    return (
      <span
        data-slot="outcome-badge"
        data-outcome="pending"
        className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
      >
        En attente
      </span>
    )
  }
  if (outcome === 'won') {
    return (
      <span
        data-slot="outcome-badge"
        data-outcome="won"
        className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
      >
        Gagné
      </span>
    )
  }
  if (outcome === 'lost') {
    return (
      <span
        data-slot="outcome-badge"
        data-outcome="lost"
        className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200"
      >
        {tag ? `Perdu — ${TAG_LABEL[tag]}` : 'Perdu'}
      </span>
    )
  }
  if (outcome === 'withdrawn') {
    return (
      <span
        data-slot="outcome-badge"
        data-outcome="withdrawn"
        className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground/70"
      >
        Retiré
      </span>
    )
  }
  // not_responded
  return (
    <span
      data-slot="outcome-badge"
      data-outcome="not_responded"
      className="inline-flex items-center rounded-full bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
    >
      Pas de réponse
    </span>
  )
}

// =================================
// Bouton + Dialog combo — composant client autonome
// =================================

interface OutcomeTriggerProps {
  tenderId: string
  currentOutcome: TenderOutcome | null
  currentReason: string | null
  currentTag: TenderOutcomeTag | null
}

export function OutcomeTrigger({
  tenderId,
  currentOutcome,
  currentReason,
  currentTag,
}: OutcomeTriggerProps) {
  const [open, setOpen] = useState(false)
  const hasOutcome = currentOutcome !== null && currentOutcome !== 'pending'

  return (
    <>
      {hasOutcome ? (
        <div className="flex items-center gap-2">
          <OutcomeBadge outcome={currentOutcome!} tag={currentTag} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            type="button"
            data-slot="outcome-edit"
          >
            Modifier
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          type="button"
          data-slot="outcome-mark"
        >
          Marquer le résultat
        </Button>
      )}
      <OutcomeDialog
        open={open}
        onOpenChange={setOpen}
        tenderId={tenderId}
        initialOutcome={currentOutcome}
        initialReason={currentReason}
        initialTag={currentTag}
      />
    </>
  )
}
