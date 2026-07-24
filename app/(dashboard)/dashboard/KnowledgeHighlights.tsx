import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LivingASavoirCard } from '@/lib/db/handover'

interface KnowledgeHighlightsProps {
  items: LivingASavoirCard[]
}

export function KnowledgeHighlights({ items }: KnowledgeHighlightsProps) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          À savoir
        </h2>
      </div>

      {items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground italic">
          Aucune capsule mémoire disponible pour le moment.{' '}
          <Link href="/memoire" className="not-italic underline underline-offset-2 hover:text-foreground">
            Ouvrir la mémoire
          </Link>
          pour en créer ou en consulter.
        </p>
      ) : (
        <ul className="divide-y divide-border/40">
          {items.map((card) => (
            <li key={card.id}>
              <Link
                href={`/sites/${card.site_id}`}
                className="group flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug line-clamp-2">{card.body}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{card.site_name}</p>
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
