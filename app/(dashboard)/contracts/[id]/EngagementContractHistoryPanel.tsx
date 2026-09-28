// DOC-CONTRACT-OS-1B3 (mandat Vincent 2026-09-29, sur 1B2-B1/B2/B3/B4 CODE
// CLOSED) — surface légère (Sheet) affichant l'historique contractuel
// explicable d'un Engagement. CONSOMMATEUR PUR du presenter
// `buildEngagementContractHistoryViewModel` : aucune logique temporelle ici,
// aucun appel réseau, aucune re-résolution.
'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { CONTRACT_EFFECT_META } from '@/lib/engagements/contract-effect'
import { buildEngagementContractHistoryViewModel } from '@/lib/engagements/contract-history-view-model'
import type { EngagementContractStateDTO } from '@/lib/engagements/resolve-contract-state'

interface EngagementContractHistoryPanelProps {
  /** État déjà résolu par B1/B3 (page contrat) — undefined si non chargé/non autorisé. */
  state: EngagementContractStateDTO | undefined
  documentTitleById?: Map<string, string>
}

export function EngagementContractHistoryPanel({ state, documentTitleById }: EngagementContractHistoryPanelProps) {
  const [open, setOpen] = useState(false)
  if (!state) return null

  const viewModel = buildEngagementContractHistoryViewModel(state, documentTitleById)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<button type="button" className="mt-1 text-[11px] font-medium text-primary hover:underline" />}
      >
        Voir l&apos;historique
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Historique contractuel</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          {viewModel.isLegacy && (
            <p className="text-[12px] italic text-muted-foreground">{viewModel.legacyMessage}</p>
          )}

          {viewModel.resolutionConflictMessage && (
            <p className="text-[12px] text-amber-700">{viewModel.resolutionConflictMessage}</p>
          )}

          {viewModel.entries.length > 0 && (
            <ul className="space-y-3">
              {viewModel.entries.map((entry) => {
                const meta = CONTRACT_EFFECT_META[entry.effect]
                return (
                  <li key={entry.effectId} className="space-y-1 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', meta.badge)}>
                        {meta.label}
                      </span>
                      {entry.inConflict && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          Conflit
                        </span>
                      )}
                    </div>

                    <p className="text-[12px] font-medium text-foreground">{entry.headline}</p>
                    {entry.dateLine && <p className="text-[11px] text-muted-foreground">{entry.dateLine}</p>}
                    {entry.valueLine && <p className="text-[11px] text-muted-foreground">{entry.valueLine}</p>}

                    {entry.engineIndeterminateReason && (
                      <p className="text-[11px] text-amber-700">{entry.engineIndeterminateReason}</p>
                    )}
                    {entry.inConflict && entry.conflictReason && (
                      <p className="text-[11px] text-amber-700">{entry.conflictReason}</p>
                    )}

                    <p className="text-[11px] text-muted-foreground">{entry.sourceLine}</p>
                    <p className="text-[10px] text-muted-foreground/70">{entry.recordedInMemoriaLine}</p>

                    {entry.contributionNote && (
                      <p className="text-[10px] italic text-muted-foreground">{entry.contributionNote}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
