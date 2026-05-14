import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import type { TenantMorningReading } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Cockpit matin : "Ce que les lieux disent ce matin".
 *
 * Doctrine Vincent 2026-05-15 (post-recadrage rareté) :
 *   - PLAFOND DUR : 1 fragment maximum, jamais 2, jamais 4
 *   - "Une IA qui se tait crée de la valeur quand elle parle"
 *   - Si rien d'émergent → la Card N'EST PAS RENDUE (zone vide assumée,
 *     pas de fallback "tout est calme", pas de "aucun signal")
 *   - Phénomène rare. Pas un feed.
 */
export function TenantMorningReadingCard({ data }: { data: TenantMorningReading }) {
  if (!data.reading) return null

  return (
    <Card className="bg-[#fafaf7] border-foreground/10">
      <CardContent className="py-5 space-y-2.5">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Ce que les lieux disent ce matin
        </h2>
        <p className="text-base leading-snug">
          {data.reading.text}
          {data.reading.fragments && data.reading.fragments.length > 0 && (
            <span className="text-muted-foreground">
              {' '}
              {data.reading.fragments.slice(0, 4).join(' · ')}
            </span>
          )}
          {data.siteName && data.siteId && (
            <Link
              href={`/sites/${data.siteId}`}
              className="text-sm text-muted-foreground hover:text-foreground ml-2"
            >
              — {data.siteName}
            </Link>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
