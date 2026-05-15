import Link from 'next/link'
import { ReadingCard } from '@/components/ui/reading-card'
import type { SiteReadings as TReadings } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Mémoire IA périphérique sur mobile chef d'équipe.
 *
 * Doctrine Vincent 2026-05-15 (post-recadrage option 2.5) :
 *   - Toujours visible, JAMAIS conditionnelle (cohérence et prévisibilité)
 *   - Plafond DUR : 2 fragments max sur mobile, jamais 3
 *   - Pas de titre : présence PÉRIPHÉRIQUE, identité visuelle via ReadingCard
 *   - Compact = pas de sous-fragments, fragment inline avec frags · séparés
 *   - Bouton "voir" discret vers la page Site mobile complète si > 2 fragments
 *
 * Si zéro fragment → composant ne s'affiche pas (`getSiteReadings` se tait
 * quand il n'y a rien à révéler, c'est la doctrine de fond).
 */
export function MobileSiteReadings({
  readings,
  siteId,
}: {
  readings: TReadings
  siteId: string
}) {
  if (readings.readings.length === 0) return null

  const visible = readings.readings.slice(0, 2)
  const hasMore = readings.readings.length > 2

  return (
    <div className="space-y-2">
      {visible.map((r, idx) => (
        <ReadingCard
          key={idx}
          fragment={r.text}
          frags={r.fragments ?? undefined}
          compact
        />
      ))}
      {hasMore && (
        <Link
          href={`/m/site/${siteId}`}
          className="inline-block text-[11px] text-muted-foreground/70 hover:text-foreground underline-offset-2"
        >
          voir
        </Link>
      )}
    </div>
  )
}
