import type { SiteIdentity } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Sous-titre / métadonnées du site, sous le H1 rendu par page.tsx.
 *
 * Pattern shadcn standard : text-sm text-muted-foreground.
 * Doctrine : "X équipes se sont succédé ici" reste affiché car descriptif
 * et continuité-centric. Pas d'avatar, pas de profil cliquable.
 */

function formatStartedAt(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const month = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return month.charAt(0).toUpperCase() + month.slice(1)
}

export function IdentityHeader({ site }: { site: SiteIdentity }) {
  const startedLabel = formatStartedAt(site.contractStartedAt)
  const subtitleParts = [
    site.contractName,
    site.clientName,
    site.address,
    startedLabel ? `depuis ${startedLabel}` : null,
  ].filter(Boolean)

  return (
    <div className="space-y-1">
      {subtitleParts.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {subtitleParts.join(' · ')}
        </p>
      )}
      {site.teamsSucceeded > 1 && (
        <p className="text-xs text-muted-foreground italic">
          {site.teamsSucceeded} équipes se sont succédé ici.
        </p>
      )}
    </div>
  )
}
