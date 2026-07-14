'use client'

import type { OperationalKPIs, ContractHealth } from '@/lib/db/admin-monitoring'

function KPICard({ label, value, unit, alert }: { label: string; value: number | null; unit?: string; alert?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card p-4 ${alert ? 'border-rose-300 bg-rose-50/30' : ''}`}>
      <div className={`text-2xl font-bold tabular-nums ${alert ? 'text-rose-700' : ''}`}>
        {value === null ? '—' : `${value}${unit ?? ''}`}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function ClosureBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-muted-foreground text-xs">—</span>
  const color = rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-400' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-right">{rate}%</span>
    </div>
  )
}

export function OperationalHealthTab({ kpis, contracts }: { kpis: OperationalKPIs; contracts: ContractHealth[] }) {
  const alerts: string[] = []
  if (kpis.closureRate !== null && kpis.closureRate < 70) alerts.push(`Taux de clôture global à ${kpis.closureRate}% (< 70%)`)
  if (kpis.openAnomalies >= 5) alerts.push(`${kpis.openAnomalies} anomalies ouvertes`)
  if (kpis.lateInterventions > 0) alerts.push(`${kpis.lateInterventions} intervention${kpis.lateInterventions > 1 ? 's' : ''} en retard`)
  const contractsInAlert = contracts.filter(c => c.closure_rate !== null && c.closure_rate < 70)

  return (
    <div className="space-y-8">
      {/* Alertes */}
      {(alerts.length > 0 || contractsInAlert.length > 0) && (
        <section className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 space-y-1">
          <div className="text-sm font-semibold text-rose-800 mb-2">Alertes</div>
          {alerts.map(a => (
            <div key={a} className="text-sm text-rose-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
              {a}
            </div>
          ))}
          {contractsInAlert.map(c => (
            <div key={c.id} className="text-sm text-rose-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
              Contrat {c.name} — taux de clôture {c.closure_rate}%
            </div>
          ))}
        </section>
      )}

      {/* KPI cards */}
      <section>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Indicateurs clés</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <KPICard
            label="Taux de clôture"
            value={kpis.closureRate}
            unit="%"
            alert={kpis.closureRate !== null && kpis.closureRate < 70}
          />
          <KPICard
            label="Couverture preuves"
            value={kpis.proofCoverage}
            unit="%"
            alert={kpis.proofCoverage !== null && kpis.proofCoverage < 50}
          />
          <KPICard
            label="Anomalies ouvertes"
            value={kpis.openAnomalies}
            alert={kpis.openAnomalies >= 5}
          />
          <KPICard
            label="Engagements sans mission"
            value={kpis.engagementsWithoutMission}
            alert={kpis.engagementsWithoutMission > 0}
          />
          <KPICard
            label="Interventions en retard"
            value={kpis.lateInterventions}
            alert={kpis.lateInterventions > 0}
          />
        </div>
      </section>

      {/* Tableau par contrat */}
      <section>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
          Par contrat ({contracts.length})
        </h2>
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Aucun contrat actif.</p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Contrat</th>
                  <th className="text-left px-3 py-2">Client</th>
                  <th className="text-right px-3 py-2">Chantiers</th>
                  <th className="text-right px-3 py-2">Planifiées</th>
                  <th className="text-right px-3 py-2">Réalisées</th>
                  <th className="text-left px-3 py-2 min-w-[120px]">Taux clôture</th>
                  <th className="text-left px-3 py-2">Dernière intervention</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {contracts.map(c => (
                  <tr key={c.id} className={`hover:bg-muted/20 ${c.closure_rate !== null && c.closure_rate < 70 ? 'bg-rose-50/30' : ''}`}>
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{c.client_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{c.sites_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{c.interventions_planned}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">{c.interventions_done}</td>
                    <td className="px-3 py-2"><ClosureBar rate={c.closure_rate} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(c.last_intervention_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
