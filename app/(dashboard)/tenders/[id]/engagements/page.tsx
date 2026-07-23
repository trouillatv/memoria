import Link from 'next/link'
import { ScanSearch } from 'lucide-react'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { listEngagementsByTender } from '@/lib/db/engagements'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { getAoExperience } from '@/lib/db/ao-experience'
import { EngagementCurationView } from '../engagement-curation-view'
import { AoExperiencePanel } from './AoExperiencePanel'
import { ExtractEngagementsButton } from './ExtractEngagementsButton'
import { BackButton } from './BackButton'

export default async function TenderEngagementsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDeskUser()
  const { id } = await params
  const engagements = await listEngagementsByTender(id)
  // A3 — confronte les libellés de cet AO à l'expérience accumulée (sujets de l'org).
  // TODO M3 : prend la première org de l'utilisateur — à adapter quand getAoExperience
  // acceptera plusieurs orgs.
  const orgId = (await getOrgIdsOfUser().catch(() => [])) [0] ?? null // TODO M4-UX-multiorg : getAoExperience ne supporte pas encore plusieurs orgs
  const experience = engagements.length > 0
    ? await getAoExperience(orgId, engagements.map((e) => e.short_label)).catch(() => [])
    : []

  return (
    <div className="space-y-4 w-full">
      <BackButton />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Engagements ({engagements.length})</h1>
          <p className="text-xs text-muted-foreground">
            Engagements extraits depuis le dossier et la mémoire technique. À curer puis activer via le wizard de conversion en contrat.
          </p>
        </div>
        {engagements.length === 0 && <ExtractEngagementsButton tenderId={id} />}
        {engagements.length > 0 && (
          <Link href={`/tenders/${id}/audit`}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40 shrink-0">
            <ScanSearch className="h-3.5 w-3.5" /> Audit documentaire
          </Link>
        )}
      </div>

      {engagements.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border p-4">
          Aucun engagement extrait. Cliquez ci-dessus pour lancer l&apos;extraction IA.
        </p>
      ) : (
        <>
          <AoExperiencePanel terms={experience} />
          <EngagementCurationView engagements={engagements} />
        </>
      )}
    </div>
  )
}
