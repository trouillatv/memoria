'use client'

// ── PILOTAGE DES ACTIONS — coquille (Tranche 1) ──────────────────────────────
// Présentationnel pur : tout vient de getActionsDashboard. Le clic sur une ligne
// ouvre la fiche canonique existante (?action=). Aucune fonction hors-tranche
// (priorité, relance, affectation entreprise) : elles restent des lots futurs.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ACTION_STATUS_LABEL, inTab, applyActionFilters,
  type ActionDashboardItem, type ActionOrigin, type ActionListStatus, type ActionTab,
} from '@/lib/knowledge/actions-dashboard-model'
import type { ActionsDashboard as Data } from '@/lib/knowledge/actions-dashboard'

const ORIGIN_LABEL: Record<ActionOrigin['type'], string> = { reunion: 'Réunion', visite: 'Visite', reserve: 'Réserve', sujet: 'Sujet' }

const STATUS_CLS: Record<ActionListStatus, string> = {
  open: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  planned: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  cancelled: 'bg-muted text-muted-foreground ring-border',
}

function frDue(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function relTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "aujourd’hui"
  if (days === 1) return 'il y a 1 jour'
  if (days < 30) return `il y a ${days} jours`
  const mo = Math.floor(days / 30)
  return mo === 1 ? 'il y a 1 mois' : `il y a ${mo} mois`
}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·'

const H4 = 'text-[11px] font-semibold uppercase tracking-wide'

function KpiCard({ label, value, accent, children }: { label: string; value: number; accent: string; children?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <p className={H4} style={{ color: accent }}>{label}</p>
      <p className="mt-1.5 text-[30px] font-bold leading-none tracking-tight tabular-nums">{value}</p>
      <div className="mt-1.5 text-[11.5px] text-muted-foreground">{children}</div>
    </div>
  )
}

const TABS: Array<{ key: ActionTab; label: string }> = [
  { key: 'all', label: 'Toutes' },
  { key: 'active', label: 'Actives' },
  { key: 'overdue', label: 'En retard' },
  { key: 'done_no_proof', label: 'Terminées sans preuve' },
  { key: 'done', label: 'Terminées' },
]

export function ActionsDashboard({ data, today }: { data: Data; today: string }) {
  const { summary, actions, filters } = data
  const [tab, setTab] = useState<ActionTab>('all')
  const [search, setSearch] = useState('')
  const [responsibleName, setResponsible] = useState<string | null>(null)
  const [originType, setOrigin] = useState<ActionOrigin['type'] | null>(null)
  const [status, setStatus] = useState<ActionListStatus | null>(null)

  const tabCounts = useMemo(() => {
    const c: Record<ActionTab, number> = { all: 0, active: 0, overdue: 0, done_no_proof: 0, done: 0 }
    for (const t of TABS) c[t.key] = actions.filter((a) => inTab(a, today, t.key)).length
    return c
  }, [actions, today])

  const rows = useMemo(() => {
    const byTab = actions.filter((a) => inTab(a, today, tab))
    return applyActionFilters(byTab, { search, responsibleName, originType, status })
  }, [actions, today, tab, search, responsibleName, originType, status])

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Actions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Pilotage des engagements et obligations</p>
        </div>
      </header>

      {/* ── 5 KPIs réels ── */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="À confirmer" value={summary.aConfirmer} accent="#d97706">
          propositions d’action à valider
          <span className="mt-2 block border-t border-dashed pt-2 text-[11px] leading-relaxed">
            Autres éléments à examiner : {summary.proposalBreakdown.deadline} échéances · {summary.proposalBreakdown.decision} décision · {summary.proposalBreakdown.knowledge} connaissances · {summary.proposalBreakdown.stakeholder} intervenants
          </span>
        </KpiCard>
        <KpiCard label="Actions actives" value={summary.actives} accent="#2563eb">
          {summary.activesBreakdown.planned} planifiées · {summary.activesBreakdown.open} ouvertes
        </KpiCard>
        <KpiCard label="En retard" value={summary.enRetard} accent="#e11d48">échéance dépassée</KpiCard>
        <KpiCard label="Terminées sans preuve" value={summary.termineesSansPreuve} accent="#059669">clôturées sans trace de clôture</KpiCard>
        <KpiCard label="Terminées" value={summary.terminees} accent="#0891b2">historique conservé</KpiCard>
      </section>

      {/* ── Onglets ── */}
      <div className="flex flex-wrap gap-5 border-b">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 border-b-2 pb-2.5 pt-1 text-sm',
              tab === t.key ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.label}
            <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', tab === t.key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{tabCounts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* ── Filtres simples ── */}
      <div className="flex flex-wrap gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une action, un responsable, une origine…"
            className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={responsibleName ?? ''} onChange={(e) => setResponsible(e.target.value || null)} className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          <option value="">Responsable</option>
          {filters.responsibles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={originType ?? ''} onChange={(e) => setOrigin((e.target.value || null) as ActionOrigin['type'] | null)} className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          <option value="">Origine</option>
          {filters.origins.map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
        </select>
        <select value={status ?? ''} onChange={(e) => setStatus((e.target.value || null) as ActionListStatus | null)} className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          <option value="">État</option>
          {filters.statuses.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      {/* ── Liste ── */}
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">État</th>
              <th className="px-4 py-3 font-semibold">Responsable</th>
              <th className="px-4 py-3 font-semibold">Échéance</th>
              <th className="px-4 py-3 font-semibold">Origine</th>
              <th className="px-4 py-3 font-semibold">Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a: ActionDashboardItem) => (
              <tr key={a.id} className="border-b border-border/50 last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3">
                  <Link href={a.href} scroll={false} className="block">
                    <span className="font-semibold text-foreground">{a.title}</span>
                    {a.description && <span className="mt-0.5 block text-[11.5px] text-muted-foreground line-clamp-1">{a.description}</span>}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1', STATUS_CLS[a.status])}>{a.statusLabel}</span>
                </td>
                <td className="px-4 py-3">
                  {a.responsibleName ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">{initials(a.responsibleName)}</span>
                      <span className="text-[13px]">{a.responsibleName}{a.responsibleSub && <span className="block text-[10.5px] text-muted-foreground">{a.responsibleSub}</span>}</span>
                    </span>
                  ) : <span className="text-[13px] text-muted-foreground/70">Aucun responsable</span>}
                </td>
                <td className="px-4 py-3 text-[13px]">
                  {a.dueDate ? (
                    <>
                      <span className="tabular-nums">{frDue(a.dueDate)}</span>
                      {a.lateness.text && (
                        <span className={cn('mt-0.5 block text-[11px] font-semibold',
                          a.lateness.tone === 'neg' ? 'text-rose-600 dark:text-rose-400' : a.lateness.tone === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                          {a.lateness.text}
                        </span>
                      )}
                    </>
                  ) : <span className="text-muted-foreground/70">—</span>}
                </td>
                <td className="px-4 py-3 text-[13px]">
                  {a.origin ? (
                    a.origin.href ? <Link href={a.origin.href} className="text-primary hover:underline">{a.origin.label}</Link> : <span className="text-muted-foreground">{a.origin.label}</span>
                  ) : <span className="text-muted-foreground/70">—</span>}
                </td>
                <td className="px-4 py-3 text-[13px]">
                  {a.lastActivity ? (
                    <><span className="text-foreground">{a.lastActivity.label}</span><span className="block text-[10.5px] text-muted-foreground">{relTime(a.lastActivity.occurredAt)}</span></>
                  ) : <span className="text-muted-foreground/70">—</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">Aucune action ne correspond à ces filtres.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 text-[12.5px] text-muted-foreground">
          <span>{rows.length} action{rows.length > 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}
