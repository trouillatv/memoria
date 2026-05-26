'use client'

// Indice de coût IA — tooltip discret (ⓘ) à côté des boutons qui déclenchent
// une opération IA (Vincent 2026-05-27). N'encombre pas l'UI : rien d'affiché
// en permanence, le détail apparaît au survol.
//
// Principe (clarifié 2026-05-27) : PAS un prix exact théorique, mais une
// MOYENNE OBSERVÉE des dernières actions du même type (lues dans ai_usage,
// passées en prop depuis le serveur). Si aucun historique → on le dit, sans
// inventer de chiffre. Affichage en XPF (ratio stable, lib/format/currency).
// Sert à responsabiliser l'utilisateur AVANT le clic — visible managers+admins.

import { Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatXpf } from '@/lib/format/currency'

export function AiCostHint({
  avgUsd,
  sampleCount = 0,
  label = 'opération',
}: {
  /** Coût USD moyen observé sur les N dernières actions de ce type. */
  avgUsd?: number | null
  /** Taille de l'échantillon (0 = aucun historique). */
  sampleCount?: number
  /** Nom du type d'action, ex. « analyse de document », « lecture AO ». */
  label?: string
}) {
  const hasHistory = sampleCount > 0 && typeof avgUsd === 'number'

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Coût IA estimé de cette action"
              className="inline-flex items-center text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            />
          }
        >
          <Info className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top" className="flex-col items-start gap-1 py-2 text-left">
          <span className="font-semibold">Coût IA indicatif</span>
          {hasHistory ? (
            <>
              <span className="opacity-90">
                ≈ {formatXpf(avgUsd!)} par {label}
              </span>
              <span className="opacity-70">
                Moyenne des {sampleCount} dernière{sampleCount > 1 ? 's' : ''} de ce
                type — pas un prix exact.
              </span>
            </>
          ) : (
            <span className="opacity-80">
              Pas encore de référence : le coût moyen s’affichera après les
              premières {label}s.
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
