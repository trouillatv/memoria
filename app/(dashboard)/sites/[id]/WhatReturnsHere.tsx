import { Repeat2 } from 'lucide-react'
import type { WhatReturnsHere as TReturns } from '@/lib/db/site-cockpit'

/**
 * « Le lieu vous rappelle » — lecture NARRATIVE des motifs récurrents (Vincent
 * 2026-06-15 : « beaucoup plus narratif » que des badges de mots bruts).
 *
 * Doctrine produit (conservée) :
 *   ❌ pas de fréquence affichée (quantification → reverse-lookup)
 *   ❌ pas de "AI insights" / ✨ (IA bavarde interdite)
 *   ✅ ordre alphabétique strict (data.words) — évite le ranking visuel
 *   ✅ formulation prudente : "revient régulièrement", jamais une conclusion
 *
 * On passe des badges à des phrases, sans exposer le compte ni reclasser par
 * fréquence — le narratif vient du verbe, pas du chiffre.
 */

export function WhatReturnsHere({ data }: { data: TReturns }) {
  if (data.words.length === 0) return null

  return (
    <ul className="space-y-1.5">
      {data.words.map((word) => (
        <li key={word} className="text-sm text-foreground/80 flex items-start gap-2">
          <Repeat2 className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground">« {word} »</span> revient régulièrement ici.
          </span>
        </li>
      ))}
    </ul>
  )
}
