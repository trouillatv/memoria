import { listAllEngagements } from '@/lib/db/engagements'
import { listContracts } from '@/lib/db/contracts'

export default async function DevEngagementsPage() {
  const [engagements, contracts] = await Promise.all([
    listAllEngagements(),
    listContracts(),
  ])
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        🛠 Page debug Slice 0 — visualisation directe des tables `contracts` et `engagements`.
        À remplacer par les vraies pages produit (slices suivantes).
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Contracts ({contracts.length})
        </h2>
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun contrat. Crée-en via le wizard (Slice 4).</p>
        ) : (
          <ul className="space-y-1.5">
            {contracts.map((c) => (
              <li key={c.id} className="rounded border bg-card p-3 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-sm">{c.name}</div>
                    <div className="text-muted-foreground">{c.client_name} · démarré {c.start_date}</div>
                  </div>
                  <span className="font-mono uppercase">{c.status}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">id: {c.id} · tender: {c.tender_id ?? '—'}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Engagements ({engagements.length})
        </h2>
        {engagements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun engagement. Lance l&apos;extraction sur un tender (Slice 1).</p>
        ) : (
          <ul className="space-y-1.5">
            {engagements.map((e) => (
              <li key={e.id} className="rounded border bg-card p-3 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono uppercase text-[10px] text-muted-foreground">{e.category}</span>
                  <span className="font-mono uppercase text-[10px]">{e.status}</span>
                  {e.ai_confidence !== null && (
                    <span className="text-[10px] text-muted-foreground">conf. {e.ai_confidence.toFixed(2)}</span>
                  )}
                </div>
                <div className="font-semibold text-sm mb-0.5">{e.short_label}</div>
                <div className="text-muted-foreground italic">« {e.source_excerpt} »</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  id: {e.id} · tender: {e.tender_id} · contract: {e.contract_id ?? '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
