'use client'

// Indice de coût IA — tooltip discret (ⓘ) à côté des boutons d'analyse
// documentaire (Vincent 2026-05-27). N'encombre pas l'UI : rien d'affiché
// en permanence, le détail apparaît au survol.
//
// Doctrine coût IA + honnêteté : on ne ment pas par un faux « 0,00 $ ».
// - Estimation chiffrée quand on connaît la taille du texte (page détail).
// - Sinon, explication du modèle de coût (embeddings négligeables, OCR
//   = quelques centimes pour un PDF scanné).
// Le coût est calculé côté serveur (source unique estimateCostUsd) et passé
// en prop — ce composant ne duplique aucune table de prix.

import { Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatXpf } from '@/lib/format/currency'

export function AiCostHint({
  model,
  estimateUsd,
  tokens,
}: {
  /** Modèle d'embedding actif (ex. gemini-embedding-001), null si aucune clé. */
  model?: string | null
  /** Coût estimé en USD (calculé serveur). null = tarif non répertorié ou inconnu. */
  estimateUsd?: number | null
  /** Tokens d'entrée estimés (≈ caractères / 4). */
  tokens?: number | null
}) {
  const hasEstimate = typeof tokens === 'number' && tokens > 0

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Coût IA estimé de l'analyse"
              className="inline-flex items-center text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            />
          }
        >
          <Info className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top" className="flex-col items-start gap-1 py-2 text-left">
          <span className="font-semibold">Coût IA de l’analyse</span>
          {model ? (
            <span className="opacity-90">Modèle : {model}</span>
          ) : (
            <span className="opacity-90">Aucune clé IA active — analyse en mode dégradé.</span>
          )}
          {hasEstimate && (
            <span className="opacity-90">
              ~{tokens!.toLocaleString('fr-FR')} tokens ·{' '}
              {typeof estimateUsd === 'number' ? `≈ ${formatXpf(estimateUsd)}` : 'tarif non répertorié'}
            </span>
          )}
          <span className="opacity-70">
            Embeddings du texte (coût quasi nul). Un PDF scanné ajoute
            l’OCR — quelques dizaines de francs selon le nombre de pages.
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
