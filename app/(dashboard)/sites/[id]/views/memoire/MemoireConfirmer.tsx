// ── « À CONFIRMER » — la file de décisions humaines (desktop) ────────────────
// Une INBOX, pas une page de lecture. Ordre : propositions (le centre) →
// recherche en SECOND plan → connaissances validées (rupture visuelle nette :
// au-dessus l'IA propose, ici l'humain a validé) → actions utiles regroupées.
// « Atelier complet » vit ICI (outil de revue/traitement), pas dans « Pourquoi ? ».

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { MemoryInbox } from '@/app/(field)/m/site/[siteId]/MemoryReviewPanel'
import { WhyButton } from '@/components/provenance/WhyButton'
import { PrepareSitePassationButton } from '../memory/PrepareSitePassationButton'
import type { MemoryReview } from '@/lib/knowledge/memory-review'
import type { MemorySignal } from '@/lib/db/site-memory-signals'
import type { DbTeam } from '@/types/db'

export function MemoireConfirmer({
  siteId,
  siteName,
  review,
  signals,
  subjectsCount,
  teams,
  searchSlot,
}: {
  siteId: string
  siteName: string
  review: MemoryReview
  signals: MemorySignal[]
  subjectsCount: number
  teams: DbTeam[]
  searchSlot?: ReactNode
}) {
  const suites = signals.reduce((n, s) => n + s.items.length, 0)
  const groups = [...new Set(review.confirmed.map((c) => c.group))]

  return (
    <div className="space-y-5">
      {/* ── L'INBOX — le centre de la page ── */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold">Propositions en attente</h2>
            {/* Une phrase de DOCTRINE produit, pas une aide secondaire. */}
            <p className="mb-3 text-[13px] text-foreground/75">Ce que l’IA a relevé. Le bouton dit exactement ce que votre validation produira.</p>
          </div>
          <Link href={`/memoire/${siteId}`} className="shrink-0 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Atelier complet
          </Link>
        </div>
        <MemoryInbox siteId={siteId} items={review.toReview} withFilters />
      </section>

      {/* ── La recherche, en SECOND plan ── */}
      {searchSlot}

      {/* ── LES CONNAISSANCES VALIDÉES — rupture visuelle nette avec les propositions ── */}
      <section className="rounded-xl border bg-muted/30 p-4">
        <h2 className="text-[15px] font-semibold">Connaissances validées</h2>
        <p className="mb-3 text-[12.5px] text-muted-foreground">Au-dessus, l’IA propose. Ici, l’humain a validé.</p>
        {review.confirmed.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Rien de confirmé pour l’instant.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g}>
                <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</h3>
                <ul className="mt-1.5 space-y-1">
                  {review.confirmed.filter((c) => c.group === g).map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-[13px] text-foreground/90">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span className="min-w-0">
                        {c.title}
                        {c.nature && <span className="ml-1.5 text-[11px] text-muted-foreground">· {c.nature}</span>}
                        {c.group === 'Décisions' && (
                          <span className="mt-0.5 block"><WhyButton objectType="decision" objectId={c.id} label="Voir l’origine" /></span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── ACTIONS UTILES — regroupées, jamais un bouton qui flotte seul ── */}
      <section>
        <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Actions utiles</h2>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <PrepareSitePassationButton siteId={siteId} siteName={siteName} teams={teams} />
          {subjectsCount > 0 && (
            <Link href={`/sites/${siteId}/subjects`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              Voir les dossiers vivants <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
          {suites > 0 && (
            <Link href={`/sites/${siteId}?tab=travail`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              Ouvrir le travail ({suites} suite{suites > 1 ? 's' : ''}) <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}
