import Link from 'next/link'
import type { SiteReadings as TReadings } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Mémoire IA périphérique sur mobile chef d'équipe.
 *
 * Doctrine Vincent 2026-05-15 (post-recadrage option 2.5) :
 *   - Toujours visible, JAMAIS conditionnelle (cohérence et prévisibilité)
 *   - Plafond DUR : 2 fragments max sur mobile, jamais 3
 *   - Pas de titre fort "NOTES DU LIEU" — présence PÉRIPHÉRIQUE
 *   - Typo gris léger, fine, comme une mémoire latente (pas une alerte)
 *   - Bouton "voir" discret vers la page Site mobile complète si > 2 fragments
 *
 * Si zéro fragment → composant ne s'affiche pas (`getSiteReadings` se tait
 * quand il n'y a rien à révéler, c'est la doctrine de fond).
 *
 * Le client (Joseph) voit ça AVANT sa checklist. Il sait que la mémoire vit
 * là, à cet endroit précis, tous les jours. Il peut l'ignorer ou s'en saisir.
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
    <div className="border-l-2 border-muted-foreground/20 pl-3 py-1.5 space-y-1">
      {visible.map((r, idx) => (
        <p
          key={idx}
          className="text-[13px] leading-snug text-muted-foreground/90"
        >
          {r.text}
          {r.fragments && r.fragments.length > 0 && (
            <span className="text-muted-foreground/70">
              {' '}
              {r.fragments.slice(0, 3).join(' · ')}
            </span>
          )}
        </p>
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
