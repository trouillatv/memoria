// /admin/monitoring — onglets et sous-onglets (Vincent 2026-05-21).
//
// Tab principal :
//   « ia »       → 3 sous-onglets : APIs · Console · Production
//   « adoption » → adoption produit + opérationnel + journal activité
//
// État dans l'URL (?tab=...&subtab=...) pour liens partageables et persistance refresh.

import { Suspense } from 'react'
import Link from 'next/link'
import type { PeriodDays } from '@/lib/db/admin-monitoring'
import {
  getAdoptionStats,
  getActivityFeed,
  getOperationalKPIs,
  getContractHealthTable,
} from '@/lib/db/admin-monitoring'
import { MonitoringShell } from './MonitoringShell'
import { AIHealthSection } from './AIHealthSection'
import { AIMemorySection } from './AIMemorySection'
import { getAuditActivitySummary } from '@/lib/db/activity-logs'
import { getAuditFailureStats } from '@/lib/audit/log'

/**
 * Santé du journal d'audit — rend l'audit OBSERVABLE (board 2026-05-26).
 * Le garde-fou « audit obligatoire » était théorique tant qu'un échec restait
 * un console.warn silencieux. Ici : volume 24h, dernier événement, et échecs
 * détectés (cette instance).
 */
async function AuditHealthCard() {
  const [summary, fails] = await Promise.all([
    getAuditActivitySummary(),
    Promise.resolve(getAuditFailureStats()),
  ])
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
  const hasFailures = fails.failures > 0
  return (
    <section
      className={`rounded-lg border p-4 ${hasFailures ? 'border-red-300 bg-red-50/50 dark:bg-red-950/20' : 'bg-card'}`}
    >
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2.5">
        Journal d'audit
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
        <div>
          <div className="text-2xl font-semibold tabular-nums">{summary.count24h}</div>
          <div className="text-xs text-muted-foreground">événements tracés (24h)</div>
        </div>
        <div>
          <div className="text-sm font-medium">{fmt(summary.lastAt)}</div>
          <div className="text-xs text-muted-foreground">dernier événement</div>
        </div>
        <div>
          <div className={`text-2xl font-semibold tabular-nums ${hasFailures ? 'text-red-600' : 'text-emerald-600'}`}>
            {fails.failures}
          </div>
          <div className="text-xs text-muted-foreground">
            échecs d'écriture (cette instance){hasFailures && fails.last ? ` · dernier : ${fails.last.action}` : ''}
          </div>
        </div>
      </div>
      {hasFailures && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">
          ⚠️ Des consultations/actions sensibles ont pu ne PAS être tracées. Vérifier la base / les RLS.
        </p>
      )}
    </section>
  )
}

type Tab = 'ia' | 'adoption'
type IaSubtab = 'apis' | 'console' | 'production'

function parsePeriod(raw: string | undefined): PeriodDays {
  const n = Number(raw)
  if (n === 7 || n === 30 || n === 90) return n
  return 30
}

function parseTab(raw: string | undefined): Tab {
  return raw === 'adoption' ? 'adoption' : 'ia'
}

function parseIaSubtab(raw: string | undefined): IaSubtab {
  if (raw === 'console' || raw === 'production') return raw
  return 'apis'
}

export default async function AdminMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; tab?: string; subtab?: string }>
}) {
  const { period: periodRaw, tab: tabRaw, subtab: subtabRaw } = await searchParams
  const period = parsePeriod(periodRaw)
  const tab = parseTab(tabRaw)
  const iaSubtab = parseIaSubtab(subtabRaw)

  const adoptionData =
    tab === 'adoption'
      ? await Promise.all([
          getAdoptionStats(period),
          getActivityFeed(period),
          getOperationalKPIs(period),
          getContractHealthTable(period),
        ])
      : null

  return (
    <div className="space-y-6">
      {/* Santé du journal d'audit — toujours visible (board 2026-05-26). */}
      <Suspense fallback={null}>
        <AuditHealthCard />
      </Suspense>

      {/* ── Onglets principaux ──────────────────────────────────────── */}
      <nav className="flex items-center gap-2 border-b" aria-label="Onglets monitoring">
        <TabLink
          href={`/admin/monitoring?tab=ia`}
          active={tab === 'ia'}
          label="Monitoring IA"
        />
        <TabLink
          href={`/admin/monitoring?tab=adoption${period !== 30 ? `&period=${period}` : ''}`}
          active={tab === 'adoption'}
          label="Adoption"
        />
      </nav>

      {/* ── Onglet IA — sous-onglets ────────────────────────────────── */}
      {tab === 'ia' && (
        <div className="space-y-4">
          <nav className="flex items-center gap-1.5 flex-wrap" aria-label="Sous-onglets IA">
            <SubtabLink
              href={`/admin/monitoring?tab=ia&subtab=apis`}
              active={iaSubtab === 'apis'}
              label="APIs IA — Mémoire"
            />
            <SubtabLink
              href={`/admin/monitoring?tab=ia&subtab=console`}
              active={iaSubtab === 'console'}
              label="Console IA — 7 derniers jours"
            />
            <SubtabLink
              href={`/admin/monitoring?tab=ia&subtab=production`}
              active={iaSubtab === 'production'}
              label="Production IA — 7 derniers jours"
            />
          </nav>

          <div className="pt-2">
            {iaSubtab === 'apis' && (
              <Suspense fallback={null}>
                <AIHealthSection />
              </Suspense>
            )}
            {iaSubtab === 'console' && (
              <Suspense fallback={null}>
                <AIMemorySection subtab="console" />
              </Suspense>
            )}
            {iaSubtab === 'production' && (
              <Suspense fallback={null}>
                <AIMemorySection subtab="production" />
              </Suspense>
            )}
          </div>
        </div>
      )}

      {/* ── Onglet Adoption ─────────────────────────────────────────── */}
      {tab === 'adoption' && adoptionData && (
        <Suspense>
          <MonitoringShell
            period={period}
            stats={adoptionData[0]}
            feed={adoptionData[1]}
            kpis={adoptionData[2]}
            contracts={adoptionData[3]}
          />
        </Suspense>
      )}
    </div>
  )
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? 'border-brand-600 text-foreground font-medium'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  )
}

function SubtabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
        active
          ? 'border-brand-600 bg-brand-50 text-brand-900 font-medium dark:bg-brand-950/30 dark:text-brand-200'
          : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/20'
      }`}
    >
      {label}
    </Link>
  )
}
