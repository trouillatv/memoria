import { listEngagementsByTender } from '@/lib/db/engagements'
import { EngagementCurationView } from '../engagement-curation-view'
import { ExtractEngagementsButton } from './ExtractEngagementsButton'
import { BackButton } from './BackButton'

export default async function TenderEngagementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const engagements = await listEngagementsByTender(id)

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
      </div>

      {engagements.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border p-4">
          Aucun engagement extrait. Cliquez ci-dessus pour lancer l&apos;extraction IA.
        </p>
      ) : (
        <EngagementCurationView engagements={engagements} />
      )}
    </div>
  )
}
