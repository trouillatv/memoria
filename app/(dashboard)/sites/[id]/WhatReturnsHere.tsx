import type { WhatReturnsHere as TReturns } from '@/lib/db/site-cockpit'
import { SectionTitle } from './SectionTitle'

/**
 * V5.1.3 — Section 6 : CE QUI REVIENT
 *
 * Doctrine Vincent 2026-05-14 : extraction de motifs faibles humains.
 * "L'IA n'écrit pas, elle révèle." Comptage de termes récurrents
 * (≥3 occurrences) sur le corpus narratif du site (anomalies, notes,
 * intervention notes). Ordre alphabétique strict pour éviter ranking visuel.
 *
 * PIÈGES À ÉVITER :
 *   ❌ "Mots importants" / "Tags principaux" → injonction interdite
 *   ❌ tag-cloud avec tailles variables → suggère ranking
 *   ❌ afficher la fréquence ("bloc B (12)") → quantification
 *   ❌ "AI insights" / "✨" → IA bavarde interdite
 *
 * Si liste vide → ne pas afficher la section (l'absence est elle-même
 * un signal — pas de motif récurrent encore détecté).
 */

export function WhatReturnsHere({ data }: { data: TReturns }) {
  if (data.words.length === 0) return null

  return (
    <section className="space-y-4">
      <SectionTitle>Ce qui revient</SectionTitle>
      <p className="text-base leading-relaxed pt-2" style={{ color: '#555' }}>
        {data.words.map((word, idx) => (
          <span key={word}>
            {word}
            {idx < data.words.length - 1 && (
              <span aria-hidden style={{ color: '#c0c0c0' }}>
                {' · '}
              </span>
            )}
          </span>
        ))}
      </p>
    </section>
  )
}
