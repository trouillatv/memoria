import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LivingASavoirCard } from '@/lib/db/handover'

interface KnowledgeHighlightsProps {
  items: LivingASavoirCard[]
}

export function KnowledgeHighlights({ items }: KnowledgeHighlightsProps) {
  return (
    <section className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
      <div className="px-5 pb-4 pt-5">
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
        <ul className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-1">
          {items.map((card) => (
            <li key={card.id}>
              <Link
                href={`/sites/${card.site_id}`}
                className="group flex h-full items-start gap-3 rounded-2xl border border-slate-100 bg-sky-50/50 px-3 py-3 transition-all hover:border-sky-200 hover:bg-white hover:shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600">✦</span>
                  <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-800">{card.body}</p>
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
