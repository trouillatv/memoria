'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { AdoptionStats, ActivityEntry, OperationalKPIs, ContractHealth, PeriodDays } from '@/lib/db/admin-monitoring'
import { AdoptionTab } from './AdoptionTab'
import { OperationalHealthTab } from './OperationalHealthTab'

type Tab = 'adoption' | 'health'

export function MonitoringShell({
  period,
  stats,
  feed,
  kpis,
  contracts,
}: {
  period: PeriodDays
  stats: AdoptionStats
  feed: ActivityEntry[]
  kpis: OperationalKPIs
  contracts: ContractHealth[]
}) {
  const [tab, setTab] = useState<Tab>('adoption')
  const router = useRouter()
  const searchParams = useSearchParams()

  function changePeriod(p: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('period', p)
    router.push(`?${params.toString()}`)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Monitoring</h1>
          <p className="text-sm text-muted-foreground">Usage réel du pilote et santé opérationnelle.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Période :</span>
          <select
            value={period}
            onChange={e => changePeriod(e.target.value)}
            className="rounded border px-2 py-1 text-sm bg-background"
          >
            <option value="7">7 derniers jours</option>
            <option value="30">30 derniers jours</option>
            <option value="90">90 derniers jours</option>
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b flex gap-0">
        {([
          { key: 'adoption', label: 'Pilote MVO' },
          { key: 'health', label: 'Santé opérationnelle' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors active:scale-[0.98] motion-safe:transition-transform ${
              tab === t.key
                ? 'border-brand-600 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content — re-fade à chaque changement d'onglet (key=tab). */}
      <div key={tab} className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
        {tab === 'adoption' && <AdoptionTab stats={stats} feed={feed} />}
        {tab === 'health' && <OperationalHealthTab kpis={kpis} contracts={contracts} />}
      </div>
    </div>
  )
}
