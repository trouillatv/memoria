import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getContract } from '@/lib/db/contracts'
import { listEngagementsByContract } from '@/lib/db/engagements'
import { EngagementCompliance } from './engagement-compliance'
import type { EngagementComplianceRatios } from '@/types/db'

// Phase 1: only PROMIS is real, rest is 0
// Health calculation alimentera Phase 2+ quand interventions/photos arrivent.
function phase1Ratios(): EngagementComplianceRatios {
  return { promised: true, planned: 0, executed: 0, proven: 0, validated: 0 }
}

function categoryColorClass(category: string): string {
  switch (category) {
    case 'frequency':  return 'text-sky-700 bg-sky-50 border-sky-200'
    case 'quality':    return 'text-emerald-700 bg-emerald-50 border-emerald-200'
    case 'compliance': return 'text-violet-700 bg-violet-50 border-violet-200'
    case 'delivery':   return 'text-orange-700 bg-orange-50 border-orange-200'
    case 'sla':        return 'text-amber-700 bg-amber-50 border-amber-200'
    case 'reporting':  return 'text-indigo-700 bg-indigo-50 border-indigo-200'
    default:           return 'text-slate-700 bg-slate-50 border-slate-200'
  }
}

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const contract = await getContract(id)
  if (!contract) notFound()

  const engagements = await listEngagementsByContract(id)

  const startLabel = new Date(contract.start_date).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  const endLabel = contract.end_date
    ? new Date(contract.end_date).toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'long', year: 'numeric',
      })
    : null

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{contract.name}</h1>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium uppercase tracking-wider bg-emerald-50 border-emerald-200 text-emerald-700">
            {contract.status}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {contract.client_name} · démarré le {startLabel}
          {endLabel && ` · jusqu'au ${endLabel}`}
        </p>
        {contract.tender_id && (
          <p className="text-xs text-muted-foreground">
            <Link href={`/tenders/${contract.tender_id}`} className="underline hover:text-foreground">
              Voir l&apos;AO d&apos;origine →
            </Link>
          </p>
        )}
      </header>

      {/* Engagements list */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Engagements ({engagements.length})
          </h2>
        </div>

        {engagements.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border p-4">
            Aucun engagement actif sur ce contrat.
          </p>
        ) : (
          <ul className="space-y-3">
            {engagements.map((e) => (
              <li key={e.id} className="rounded-lg border p-4 bg-card">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold mb-0.5">{e.short_label}</div>
                    <div className="text-[11px] text-muted-foreground italic line-clamp-2">
                      « {e.source_excerpt} »
                    </div>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] uppercase font-semibold tracking-widest shrink-0 ${categoryColorClass(e.category)}`}>
                    {e.category}
                  </span>
                </div>
                <EngagementCompliance ratios={phase1Ratios()} size="medium" />
              </li>
            ))}
          </ul>
        )}

        {engagements.length > 0 && (
          <p className="text-[11px] text-muted-foreground italic mt-4 rounded-lg border border-dashed p-3 bg-muted/30">
            Note : les phases <strong>planification / exécution / preuves / validation</strong> seront alimentées
            dès la mise en place du module Field (Phase 2). Pour l&apos;instant, seul le status PROMIS reflète l&apos;activation contractuelle.
          </p>
        )}
      </section>
    </div>
  )
}
