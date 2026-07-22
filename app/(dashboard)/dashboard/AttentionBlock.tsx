import Link from 'next/link'
import { AlertTriangle, Eye, CheckCircle2, ChevronRight, Lock } from 'lucide-react'
import type { AttentionDigest, AttentionItem } from '@/lib/db/attention'
import { OrgBadge, orgLabelOf, type OrgLabels } from '@/components/dashboard/OrgBadge'

function Row({ it, orgLabels }: { it: AttentionItem; orgLabels: OrgLabels }) {
  const badge = orgLabelOf(orgLabels, it.organizationId)
  return (
    <Link href={it.href} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40 transition-colors">
      <span className="min-w-0 flex-1">
        <span className="text-sm font-medium">
          {badge && <><OrgBadge label={badge} /> </>}
          {it.what} <span className="font-normal text-muted-foreground">— {it.where}</span>
        </span>
        <span className="block text-xs text-muted-foreground">{it.why}</span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** « Ce qui mérite votre attention » — bloc de surfaçage déterministe (Temps 2).
 *  Le système décide des priorités du jour ; l'utilisateur ne fouille pas 150 actions. */
export function AttentionBlock({ digest, orgLabels = null }: { digest: AttentionDigest; orgLabels?: OrgLabels }) {
  const { red, orange, greenSites, totalSites, closedToday = [] } = digest
  if (totalSites === 0) return null
  const nothing = red.length === 0 && orange.length === 0

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Ce qui mérite votre attention
      </h2>

      {/* Fermés aujourd'hui : un fait de la journée, pas une alerte. Il se dit
          une fois, sans couleur — un magasin fermé n'appelle aucune action. */}
      {closedToday.length > 0 && (
        <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span>
            Fermé{closedToday.length > 1 ? 's' : ''} aujourd&apos;hui :{' '}
            {closedToday.map((c, i) => (
              <span key={c.siteId}>
                {i > 0 && ', '}
                <Link href={`/sites/${c.siteId}`} className="font-medium hover:underline">
                  {c.siteName}
                </Link>{' '}
                <span className="opacity-80">({c.reason.toLowerCase()})</span>
              </span>
            ))}
          </span>
        </p>
      )}

      {nothing ? (
        <p className="inline-flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> En rythme — {totalSites} chantier{totalSites > 1 ? 's' : ''}, rien à signaler aujourd&apos;hui.
        </p>
      ) : (
        <div className="space-y-3">
          {red.length > 0 && (
            <div className="space-y-0.5">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
                <AlertTriangle className="h-3.5 w-3.5" /> À traiter
              </p>
              <ul>{red.map((it, i) => <li key={i}><Row it={it} orgLabels={orgLabels} /></li>)}</ul>
            </div>
          )}
          {orange.length > 0 && (
            <div className="space-y-0.5">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <Eye className="h-3.5 w-3.5" /> À surveiller
              </p>
              <ul>{orange.map((it, i) => <li key={i}><Row it={it} orgLabels={orgLabels} /></li>)}</ul>
            </div>
          )}
          {greenSites > 0 && (
            <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700/80">
              <CheckCircle2 className="h-3.5 w-3.5" /> {greenSites} chantier{greenSites > 1 ? 's' : ''} en rythme.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
