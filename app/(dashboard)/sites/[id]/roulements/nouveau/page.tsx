// PL5a — créer un roulement. Depuis le chantier, sans contrat.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listMissionsBySite, listPrestationNamesForOrg } from '@/lib/db/missions'
import { getCycle } from '@/lib/db/planning-cycles'
import { CycleEditor } from '../CycleEditor'
import { listTeamsWithDisplayName } from '../team-labels'

export const dynamic = 'force-dynamic'

export default async function NouveauRoulementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ copier?: string }>
}) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const { copier } = await searchParams
  const [identity, missions, teams, knownPrestations] = await Promise.all([
    getSiteIdentity(id),
    listMissionsBySite(id).catch(() => []),
    listTeamsWithDisplayName(),
    listPrestationNamesForOrg().catch(() => [] as string[]),
  ])
  if (!identity) notFound()

  // DUPLIQUER : la grille d'un roulement existant sert de point de départ.
  // Garde anti-IDOR identique à la réouverture : le modèle doit appartenir à CE
  // chantier — on ne copie pas la grille d'un autre tenant par son id.
  const source = copier ? await getCycle(copier).catch(() => null) : null
  if (copier && (!source || source.siteId !== id)) notFound()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={`/sites/${id}/roulements`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Roulements
      </Link>

      <header>
        <h1 className="text-2xl font-semibold leading-tight">Créer un roulement</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{identity.name}</p>
      </header>

      <CycleEditor
        // La mémoire du tenant : ce qui a déjà été écrit ailleurs.
        knownPrestations={knownPrestations}
        isCopy={Boolean(source)}
        {...(source
          ? {
              initial: {
                id: source.id, // jamais renvoyé au serveur : isCopy crée
                missionId: source.missionId,
                name: source.name,
                cycleLengthWeeks: source.cycleLengthWeeks,
                anchorDate: source.anchorDate,
                startsOn: source.startsOn,
                endsOn: source.endsOn,
                slots: source.slots,
              },
            }
          : {})}
        siteId={id}
        missions={missions.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }))}
        teams={teams}
      />
    </div>
  )
}
