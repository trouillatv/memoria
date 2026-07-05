import Link from 'next/link'
import { ChevronRight, Building2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listMeetingSitesAction } from '../meeting-actions'

export const dynamic = 'force-dynamic'

/**
 * Chantiers — « ce que je pilote ». Le vrai centre de MemorIA : chaque chantier
 * regroupe visites, réunions, actions, réserves, documents, entreprises, mémoire
 * et frise. Vue SOBRE (texte, pas de grandes photos) — les images vivent dans les
 * visites/réserves. On rejoint la même fiche que par « Sites » (2 portes, 1 dossier).
 */
export default async function ChantiersPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null
  const sites = await listMeetingSitesAction().catch(() => [])

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold">
          <Building2 className="h-5 w-5 text-muted-foreground" /> Chantiers
        </h1>
        <p className="text-sm text-muted-foreground">Ce que vous pilotez.</p>
      </header>

      {sites.length === 0 ? (
        <EmptyState title="Aucun chantier" description="Vos chantiers apparaîtront ici." />
      ) : (
        <ul className="space-y-1.5">
          {sites.map((s) => (
            <li key={s.id}>
              <Link
                href={`/m/site/${s.id}`}
                className="flex items-center gap-2 rounded-xl border bg-card px-3.5 py-3 text-sm active:scale-[0.99] transition-transform"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
