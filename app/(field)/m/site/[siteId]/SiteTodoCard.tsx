import Link from 'next/link'
import { AlertCircle, Clock, AlertTriangle, ListTodo, ChevronRight } from 'lucide-react'
import { addDaysLocal } from '@/lib/time/local-date'
import { OpenActionsList } from '@/components/actions/OpenActionsList'
import type { SiteActionRow } from '@/lib/db/site-actions'

/**
 * « Que reste-t-il à faire ? » — la fiche chantier devient un tableau de bord
 * OPÉRATIONNEL. Le conducteur veut d'abord savoir quoi faire MAINTENANT, avant
 * l'historique. Ordre d'urgence : 🔴 en retard · 🟠 bientôt · 🟡 réserves · ✅ ouvert.
 * Déterministe (échéances comparées à aujourd'hui). La liste complète vit sur /m/actions.
 */
export interface ReserveLite { id: string; label: string; location: string | null }

export function SiteTodoCard({
  actions,
  reserves,
  todayIso,
  totalActions,
  siteId,
}: {
  actions: SiteActionRow[]
  reserves: ReserveLite[]
  todayIso: string
  totalActions: number
  siteId: string
}) {
  const soonCutoff = addDaysLocal(todayIso, 7)
  const overdue = actions.filter((a) => a.due_date && a.due_date < todayIso)
  const soon = actions.filter((a) => a.due_date && a.due_date >= todayIso && a.due_date <= soonCutoff)
  const later = actions.filter((a) => !a.due_date || a.due_date > soonCutoff)
  if (overdue.length === 0 && soon.length === 0 && later.length === 0 && reserves.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <ListTodo className="h-4 w-4" /> Que reste-t-il à faire ?
      </h2>

      {overdue.length > 0 && (
        <Group icon={<AlertCircle className="h-4 w-4 text-red-600" />} label={`En retard (${overdue.length})`}>
          <OpenActionsList actions={overdue} compact />
        </Group>
      )}
      {soon.length > 0 && (
        <Group icon={<Clock className="h-4 w-4 text-amber-600" />} label={`À faire bientôt (${soon.length})`}>
          <OpenActionsList actions={soon} compact />
        </Group>
      )}
      {reserves.length > 0 && (
        <Group icon={<AlertTriangle className="h-4 w-4 text-yellow-600" />} label={`Réserves ouvertes (${reserves.length})`}>
          <ul className="space-y-1">
            {reserves.slice(0, 5).map((r) => (
              <li key={r.id} className="rounded-lg border bg-card px-3 py-2 text-sm">
                {r.label}
                {r.location && <span className="text-muted-foreground"> · {r.location}</span>}
              </li>
            ))}
          </ul>
        </Group>
      )}
      {later.length > 0 && (
        <Group icon={<ListTodo className="h-4 w-4 text-emerald-600" />} label={`Actions ouvertes (${later.length})`}>
          <OpenActionsList actions={later.slice(0, 3)} compact />
        </Group>
      )}

      {totalActions > 3 && (
        <Link href={`/m/actions?site=${siteId}`} className="inline-flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-foreground">
          Voir toutes les actions <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </section>
  )
}

function Group({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">{icon} {label}</p>
      {children}
    </div>
  )
}
