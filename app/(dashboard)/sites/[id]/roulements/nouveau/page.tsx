// PL5a — créer un roulement. Depuis le chantier, sans contrat.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { listMissionsBySite } from '@/lib/db/missions'
import { CycleEditor } from '../CycleEditor'
import { listTeamsWithDisplayName } from '../team-labels'

export const dynamic = 'force-dynamic'

export default async function NouveauRoulementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')

  const { id } = await params
  const [identity, missions, teams] = await Promise.all([
    getSiteIdentity(id),
    listMissionsBySite(id).catch(() => []),
    listTeamsWithDisplayName(),
  ])
  if (!identity) notFound()

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
        siteId={id}
        missions={missions.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name }))}
        teams={teams}
      />
    </div>
  )
}
