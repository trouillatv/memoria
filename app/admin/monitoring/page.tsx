import { Suspense } from 'react'
import type { PeriodDays } from '@/lib/db/admin-monitoring'
import {
  getAdoptionStats,
  getActivityFeed,
  getOperationalKPIs,
  getContractHealthTable,
} from '@/lib/db/admin-monitoring'
import { MonitoringShell } from './MonitoringShell'

function parsePeriod(raw: string | undefined): PeriodDays {
  const n = Number(raw)
  if (n === 7 || n === 30 || n === 90) return n
  return 30
}

export default async function AdminMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodRaw } = await searchParams
  const period = parsePeriod(periodRaw)

  const [stats, feed, kpis, contracts] = await Promise.all([
    getAdoptionStats(period),
    getActivityFeed(period),
    getOperationalKPIs(period),
    getContractHealthTable(period),
  ])

  return (
    <Suspense>
      <MonitoringShell
        period={period}
        stats={stats}
        feed={feed}
        kpis={kpis}
        contracts={contracts}
      />
    </Suspense>
  )
}
