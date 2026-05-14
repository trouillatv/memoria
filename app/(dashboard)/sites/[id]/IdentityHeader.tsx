import { Building2 } from 'lucide-react'
import type { SiteIdentity } from '@/lib/db/site-cockpit'

function formatStartedAt(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const month = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return month.charAt(0).toUpperCase() + month.slice(1)
}

export function IdentityHeader({ site }: { site: SiteIdentity }) {
  const startedLabel = formatStartedAt(site.contractStartedAt)
  const metaParts = [
    site.contractName,
    site.address,
    startedLabel ? `depuis ${startedLabel}` : null,
  ].filter(Boolean)

  return (
    <div className="space-y-1.5">
      {/* Badge client — la "catégorie" du lieu */}
      {site.clientName && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/60 border text-xs text-muted-foreground">
          <Building2 className="h-3 w-3 shrink-0" aria-hidden />
          {site.clientName}
        </div>
      )}
      {metaParts.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {metaParts.join(' · ')}
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
