import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

// Cartes d'une rubrique (Actions / Mémoire / Documents). On découvre les sous-vues
// EN ENTRANT dans la rubrique — la fiche chantier ne montre que 5 entrées.
export function HubGrid({ items }: { items: Array<{ href: string; label: string; desc: string; icon: React.ReactNode; badge?: string | null }> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((it) => (
        <Link key={it.href} href={it.href}
          className="flex items-start gap-3 rounded-2xl border bg-card p-4 transition hover:border-foreground/30 hover:bg-muted/30">
          <span className="mt-0.5 text-muted-foreground">{it.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold">{it.label}</span>
              {it.badge && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums">{it.badge}</span>}
            </span>
            <span className="block text-xs text-muted-foreground">{it.desc}</span>
          </span>
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )
}
