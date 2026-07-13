// « Les écoles ferment aux vacances. »
//
// Guillaume nettoie des écoles. Il déclarait la même fermeture, à la main, sur
// chaque école : six écoles × cinq périodes = trente saisies identiques, chaque
// année. Le calendrier est un fait d'ORGANISATION — on le saisit une fois.
//
// ⚠️ Aucune date n'est pré-remplie : le calendrier calédonien change chaque
// année et n'est pas déductible. Inventer une date fermerait une école un jour
// où elle est ouverte — pire que ne rien savoir.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarDays, School } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listPeriods, listFollowingSiteIds } from '@/lib/db/school-calendar'
import { createAdminClient } from '@/lib/supabase/admin'
import { CalendarEditor } from './CalendarEditor'

export const dynamic = 'force-dynamic'

export default async function CalendrierScolairePage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const [periods, followingIds] = await Promise.all([
    listPeriods().catch(() => []),
    listFollowingSiteIds().catch(() => [] as string[]),
  ])

  let following: Array<{ id: string; name: string }> = []
  if (followingIds.length > 0) {
    const { data } = await createAdminClient()
      .from('sites')
      .select('id, name')
      .in('id', followingIds)
      .order('name')
    following = (data ?? []) as Array<{ id: string; name: string }>
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-semibold leading-tight">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          Calendrier scolaire
        </h1>
        <p className="text-sm text-muted-foreground">
          Les périodes de vacances, saisies une fois. Les chantiers qui les suivent ferment
          automatiquement — dans la semaine, dans les roulements, partout.
        </p>
      </header>

      <CalendarEditor periods={periods} followingCount={following.length} />

      <section className="space-y-2 rounded-2xl border bg-card p-4">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <School className="h-4 w-4 text-muted-foreground" />
          Chantiers qui suivent ce calendrier
        </h2>
        {following.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun pour l’instant. Sur la fiche d’un chantier, cochez «&nbsp;Ce chantier ferme
            pendant les vacances scolaires&nbsp;».
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {following.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sites/${s.id}`}
                  className="inline-flex rounded-lg border bg-background px-2 py-1 text-xs hover:bg-muted"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
