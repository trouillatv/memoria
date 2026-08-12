'use client'

// Drawer de revue pour une proposition non encore matérialisée.
// Montre le contexte (pourquoi proposée, source détectée) et permet
// de créer l'élément directement sans repasser par la liste principale.

import { useState } from 'react'
import { X, Check, Loader2 } from 'lucide-react'
import { createFromCrAction, type ReviewItem } from './cr-concretisation-actions'
import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = {
  action: 'Action', echeance: 'Échéance', decision: 'Décision', memoire: 'À mémoriser',
}

// item.kind → proposal.kind
const KIND_MAP: Record<string, string> = {
  action: 'action', echeance: 'deadline', decision: 'decision', memoire: 'knowledge', intervenant: 'stakeholder',
}

function findProposal(item: ReviewItem, proposals: DbKnowledgeProposal[]): DbKnowledgeProposal | undefined {
  const targetKind = KIND_MAP[item.kind]
  const targetTitle = item.label.trim().toLowerCase()
  return proposals.find(
    (p) => p.kind === targetKind && p.title.trim().toLowerCase() === targetTitle,
  )
}

export function ActionProposalDrawer({
  item,
  proposals,
  reportId,
  onClose,
  onCreated,
}: {
  item: ReviewItem | null
  proposals: DbKnowledgeProposal[]
  reportId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  if (!item) return null

  const proposal = findProposal(item, proposals)

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    const res = await createFromCrAction(reportId, [item.key])
    setCreating(false)
    if (!res.ok) { setCreateError(res.error); return }
    onCreated()
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      {/* Feuille basse */}
      <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t bg-background">
        <div className="mx-auto max-w-md px-4 pb-8 pt-4">

          {/* En-tête */}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className={cn(
                'mb-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                item.kind === 'action'    && 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
                item.kind === 'echeance'  && 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
                item.kind === 'decision'  && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
                item.kind === 'memoire'   && 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
              )}>
                {KIND_LABEL[item.kind] ?? item.kind}
              </span>
              <p className="text-[15px] font-semibold leading-snug">{item.label}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Métadonnées détectées */}
            {(item.owner || item.due || item.constraint) && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-[12px] space-y-0.5">
                {item.owner && (
                  <p className="text-muted-foreground">
                    Responsable détecté : <span className="font-medium text-foreground">{item.owner}</span>
                  </p>
                )}
                {(item.due || item.constraint) && (
                  <p className="text-muted-foreground">
                    Échéance détectée : <span className="font-medium text-foreground">{item.due ?? item.constraint}</span>
                  </p>
                )}
              </div>
            )}

            {/* Rationale IA */}
            {proposal?.body && (
              <div className="rounded-lg border-l-2 border-violet-300 bg-violet-50/50 px-3 py-2 dark:border-violet-700 dark:bg-violet-950/20">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pourquoi proposé</p>
                <p className="text-[12px] leading-relaxed">{proposal.body}</p>
              </div>
            )}

            {/* Section source */}
            <p className="text-[11px] text-muted-foreground">
              Extrait de la section <span className="font-medium text-foreground">{item.sourceSection}</span> du compte-rendu.
            </p>
          </div>

          {createError && (
            <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{createError}</p>
          )}

          {/* Actions */}
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-[13px] font-semibold text-background disabled:opacity-50"
            >
              {creating
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                : <Check className="h-4 w-4" aria-hidden />}
              Créer dans le chantier
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted/40"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
