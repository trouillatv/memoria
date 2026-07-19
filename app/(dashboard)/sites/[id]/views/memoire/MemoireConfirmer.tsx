// ── « À CONFIRMER » — la file de décisions humaines (desktop) ────────────────
// Une INBOX, pas une page de lecture : voici ce que l'IA propose, voici ce que
// votre validation produira. Frontière NETTE : les propositions d'abord, les
// connaissances VALIDÉES dans leur propre section — jamais une même pile.
// Les anciens blocs (suites, dossiers vivants, passation) deviennent des accès
// secondaires : la page garde un centre de gravité.

import Link from 'next/link'
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
}: {
  siteId: string
  siteName: string
  review: MemoryReview
  signals: MemorySignal[]
  subjectsCount: number
  teams: DbTeam[]
}) {
  const suites = signals.reduce((n, s) => n + s.items.length, 0)
  const groups = [...new Set(review.confirmed.map((c) => c.group))]

  return (
    <div className="space-y-5">
      {/* ── L'INBOX — le travail est ici ── */}
      <section>
        <h2 className="text-[15px] font-semibold">Propositions en attente</h2>
        <p className="mb-3 text-[12.5px] text-muted-foreground">Ce que l’IA a relevé. Le bouton dit exactement ce que votre validation produira.</p>
        <MemoryInbox siteId={siteId} items={review.toReview} withFilters />
      </section>

      {/* ── LES CONNAISSANCES VALIDÉES — l'autre monde, clairement séparé ── */}
      <section className="border-t pt-4">
        <h2 className="text-[15px] font-semibold">Ce que le chantier sait</h2>
        <p className="mb-3 text-[12.5px] text-muted-foreground">Uniquement ce qu’un humain a validé.</p>
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

      {/* ── ACCÈS SECONDAIRES — des raccourcis, pas des blocs empilés ── */}
      <section className="flex flex-wrap items-center gap-2 border-t pt-4 text-[12.5px]">
        {suites > 0 && (
          <Link href={`/sites/${siteId}?tab=travail`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            {suites} élément{suites > 1 ? 's' : ''} demande{suites > 1 ? 'nt' : ''} une suite <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
        {subjectsCount > 0 && (
          <Link href={`/sites/${siteId}/subjects`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            Explorer les dossiers vivants <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <PrepareSitePassationButton siteId={siteId} siteName={siteName} teams={teams} />
      </section>
    </div>
  )
}
