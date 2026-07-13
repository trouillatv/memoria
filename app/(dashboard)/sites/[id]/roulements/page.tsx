// PL5a — les roulements d'un chantier.
//
// « Créer un roulement » depuis la fiche chantier. Pas de contrat, pas de détour
// par une mission à modifier : le roulement est un objet du chantier.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Plus, Repeat, CalendarRange } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listCyclesBySite } from '@/lib/db/planning-cycles'
import { frDayMonthLocal } from '@/lib/time/local-date'
import { RemoveCycleButton } from './RemoveCycleButton'

export const dynamic = 'force-dynamic'

const WEEK_LABEL = (n: number) => (n === 1 ? '1 semaine' : `${n} semaines`)

export default async function RoulementsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, cycles] = await Promise.all([
    getSiteIdentity(id),
    listCyclesBySite(id).catch(() => []),
  ])
  if (!identity) notFound()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/sites/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {identity.name}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold leading-tight">
            <Repeat className="h-5 w-5 text-muted-foreground" /> Roulements
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Qui travaille, quels jours, en rotation — et jusqu&apos;à quand.
          </p>
        </div>
        <Link
          href={`/sites/${id}/roulements/nouveau`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Créer un roulement
        </Link>
      </header>

      {cycles.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Aucun roulement. Les prestations sont saisies une par une.
        </p>
      ) : (
        <ul className="space-y-2">
          {cycles.map((c) => {
            const worked = c.slots.filter((s) => s.state === 'work').length
            return (
              <li key={c.id} className="group rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/sites/${id}/roulements/${c.id}`} className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{c.name}</span>
                      {/* Un brouillon ne place RIEN dans la semaine : il faut que ça se voie. */}
                      {c.status === 'draft' && (
                        <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                          Brouillon
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {WEEK_LABEL(c.cycleLengthWeeks)} ·{' '}
                      {worked === 0 ? 'aucun jour travaillé' : `${worked} jour${worked > 1 ? 's' : ''} travaillé${worked > 1 ? 's' : ''}`}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarRange className="h-3.5 w-3.5" />
                      Depuis le {frDayMonthLocal(c.startsOn)}
                      {c.endsOn ? `, jusqu’au ${frDayMonthLocal(c.endsOn)}` : ' — sans date de fin'}
                    </p>
                  </Link>
                  <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <RemoveCycleButton cycleId={c.id} name={c.name} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
