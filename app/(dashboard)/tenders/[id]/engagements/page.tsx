import { listEngagementsByTender } from '@/lib/db/engagements'
import { ExtractEngagementsButton } from './ExtractEngagementsButton'

export default async function TenderEngagementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const engagements = await listEngagementsByTender(id)

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Engagements ({engagements.length})</h1>
          <p className="text-xs text-muted-foreground">
            Engagements extraits depuis l&apos;AO et la mémoire technique. À curer puis activer via le wizard de conversion en contrat.
          </p>
        </div>
        {engagements.length === 0 && <ExtractEngagementsButton tenderId={id} />}
      </div>

      {engagements.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-lg border p-4">
          Aucun engagement extrait pour cet AO. Cliquez sur le bouton ci-dessus pour lancer l&apos;extraction IA.
        </p>
      ) : (
        <ul className="space-y-2">
          {engagements.map((e) => (
            <li key={e.id} className="rounded-lg border p-3 bg-card">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] uppercase font-semibold tracking-widest text-muted-foreground">{e.category}</span>
                <span className="text-[10px] text-muted-foreground">conf. {e.ai_confidence?.toFixed(2) ?? '—'}</span>
                <span className="text-[10px] uppercase font-mono text-muted-foreground ml-auto">{e.status}</span>
              </div>
              <div className="text-sm font-semibold mb-1">{e.short_label}</div>
              <div className="text-xs text-muted-foreground italic">« {e.source_excerpt} »</div>
              {e.source_ref && typeof e.source_ref === 'object' && (
                <div className="text-[10px] text-muted-foreground mt-1 font-mono">
                  {JSON.stringify(e.source_ref)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
