// PL5a — ROUVRIR un roulement, et retrouver EXACTEMENT sa grille.
//
// C'est le test de l'objet : un assistant qui aurait généré vingt récurrences
// ne saurait pas rouvrir quoi que ce soit. Le cycle, lui, se relit.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listMissionsBySite } from '@/lib/db/missions'
import { getCycle } from '@/lib/db/planning-cycles'
import { CycleEditor } from '../CycleEditor'
import { listTeamsWithDisplayName } from '../team-labels'

export const dynamic = 'force-dynamic'

export default async function RoulementPage({
  params,
}: {
  params: Promise<{ id: string; cycleId: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id, cycleId } = await params
  const [identity, cycle, missions, teams] = await Promise.all([
    getSiteIdentity(id),
    getCycle(cycleId),
    listMissionsBySite(id).catch(() => []),
    listTeamsWithDisplayName(),
  ])
  // Garde anti-IDOR : le roulement doit bien appartenir à CE chantier.
  if (!identity || !cycle || cycle.siteId !== id) notFound()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/sites/${id}/roulements`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Roulements
      </Link>

      <header>
        <h1 className="text-2xl font-semibold leading-tight">{cycle.name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{identity.name}</p>
      </header>

      <CycleEditor
        siteId={id}
        missions={missions.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }))}
        teams={teams}
        initial={{
          id: cycle.id,
          missionId: cycle.missionId,
          name: cycle.name,
          cycleLengthWeeks: cycle.cycleLengthWeeks,
          anchorDate: cycle.anchorDate,
          startsOn: cycle.startsOn,
          endsOn: cycle.endsOn,
          slots: cycle.slots,
        }}
      />
    </div>
  )
}
