import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { deriveCanonicalAttentionItems } from '@/lib/knowledge/canonical-attention'
import { sliceOverview } from '@/lib/knowledge/overview-counter'
import { CanonicalAttentionRow } from '@/components/site/CanonicalAttentionRow'

// ── BLOC "CE QUI DEMANDE VOTRE ATTENTION" ─────────────────────────────────────
// Doctrine : 1 item = 1 canonical_subject. Signaux fusionnés, raisons explicables.
// Source : deriveCanonicalAttentionItems() — 100% déterministe, zéro LLM.
// Pas de score brut affiché. Accès direct à la fiche sujet.
//
// #231 : population COMPLÈTE lue (aucun cap moteur), 3 affichés, « +N autres »
// EXACT (total − 3), destination = vue Attention de la page Histoire qui montre
// exactement cette même population (même read-model, même carte partagée).

const APERCU_ATTENTION_CAP = 3

export async function SiteAttentionSection({ siteId }: { siteId: string }) {
  const all = await deriveCanonicalAttentionItems(siteId).catch(() => [])
  if (all.length === 0) return null

  const { total, shown, hiddenCount } = sliceOverview(all, APERCU_ATTENTION_CAP)

  return (
    <section aria-labelledby="attention-heading">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          id="attention-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Ce qui demande votre attention
        </h2>
        {hiddenCount > 0 && (
          <Link
            href={`/sites/${siteId}/historique?view=attention`}
            className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            +{hiddenCount} autre{hiddenCount > 1 ? 's' : ''} · Voir les {total}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="space-y-2">
        {shown.map((item, i) => (
          <CanonicalAttentionRow key={i} item={item} />
        ))}
      </div>
    </section>
  )
}

export function SiteAttentionSkeleton() {
  return (
    <section>
      <div className="mb-3 h-4 w-40 rounded bg-muted animate-pulse" />
      <div className="space-y-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-14 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>
    </section>
  )
}
