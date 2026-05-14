import { Badge } from '@/components/ui/badge'
import type { WhatReturnsHere as TReturns } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Mots récurrents, pattern shadcn (Badge variant secondary).
 *
 * Doctrine produit (reste valide) :
 *   ❌ pas de tag-cloud avec tailles variables (suggère ranking)
 *   ❌ pas de fréquence affichée (quantification → reverse-lookup)
 *   ❌ pas de "AI insights" / ✨ (IA bavarde interdite)
 *   ✅ ordre alphabétique strict (évite ranking visuel)
 *
 * Si pas de mots, le composant n'est pas rendu (cf. page.tsx qui le wrappe
 * dans Card conditionnellement).
 */

export function WhatReturnsHere({ data }: { data: TReturns }) {
  if (data.words.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {data.words.map((word) => (
        <Badge key={word} variant="secondary" className="font-normal">
          {word}
        </Badge>
      ))}
    </div>
  )
}
