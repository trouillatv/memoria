'use client'

import { useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Search } from 'lucide-react'
import type {
  CopilotStats,
  CopilotScopeBreakdown,
  CopilotInteractionRow,
} from '@/lib/db/copilot-interactions-read'
import { InteractionDrawer } from './InteractionDrawer'

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(n: number) { return `${n}%` }

function answerStatusBadge(s: string | null) {
  if (!s) return null
  const classes: Record<string, string> = {
    answered: 'bg-green-100 text-green-800',
    not_found: 'bg-red-100 text-red-800',
    ambiguous: 'bg-amber-100 text-amber-800',
    insufficient_data: 'bg-orange-100 text-orange-800',
    provider_error: 'bg-red-200 text-red-900',
  }
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${classes[s] ?? 'bg-slate-100 text-slate-700'}`}>{s}</span>
}

function answerModeBadge(m: string | null) {
  if (!m) return null
  const classes: Record<string, string> = {
    llm: 'bg-violet-100 text-violet-800',
    deterministic_fallback: 'bg-sky-100 text-sky-800',
    clarification: 'bg-amber-100 text-amber-800',
  }
  const labels: Record<string, string> = {
    llm: 'LLM',
    deterministic_fallback: 'Fallback',
    clarification: 'Clarif.',
  }
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${classes[m] ?? 'bg-slate-100 text-slate-700'}`}>{labels[m] ?? m}</span>
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Filters {
  days: number
  siteId: string | null
  scope: string | null
  answerStatus: string | null
  answerMode: string | null
  search: string | null
  page: number
}

interface Props {
  stats: CopilotStats
  scopeBreakdown: CopilotScopeBreakdown[]
  rows: CopilotInteractionRow[]
  total: number
  filters: Filters
}

const SCOPES = ['site', 'canonical_subject', 'action', 'actor', 'visit', 'historical_pv', 'visit_plan', 'unknown']
const ANSWER_STATUSES = ['answered', 'not_found', 'ambiguous', 'insufficient_data', 'provider_error']
const ANSWER_MODES = ['llm', 'deterministic_fallback', 'clarification']

// ── Component ─────────────────────────────────────────────────────────────────

export function CopilotJournalShell({ stats, scopeBreakdown, rows, total, filters }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [openId, setOpenId] = useState<string | null>(null)
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '')

  const buildUrl = useCallback((patch: Partial<Filters & { q: string }>) => {
    const sp = new URLSearchParams()
    const merged = { ...filters, ...patch }
    if (merged.days !== 30) sp.set('days', String(merged.days))
    if (merged.siteId) sp.set('site', merged.siteId)
    if (merged.scope) sp.set('scope', merged.scope)
    if (merged.answerStatus) sp.set('answer_status', merged.answerStatus)
    if (merged.answerMode) sp.set('answer_mode', merged.answerMode)
    if ((patch as { q?: string }).q) sp.set('q', (patch as { q?: string }).q!)
    else if (filters.search) sp.set('q', filters.search)
    if (merged.page > 1) sp.set('page', String(merged.page))
    const qs = sp.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [filters, pathname])

  const nav = useCallback((patch: Partial<Filters & { q: string }>) => {
    router.push(buildUrl(patch))
  }, [buildUrl, router])

  const limit = 50
  const pageCount = Math.ceil(total / limit)

  return (
    <>
      {/* ── KPI ────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Interactions" value={stats.totalInteractions} />
        <KpiCard label="Utilisateurs uniques" value={stats.uniqueUsers} />
        <KpiCard label="Sites actifs" value={stats.uniqueSites} />
        <KpiCard label="Taux LLM" value={pct(stats.llmRate)} sub={`Fallback ${pct(stats.fallbackRate)}`} />
        <KpiCard label="Non répondus" value={pct(stats.notFoundRate)} sub={`Clarif. ${pct(stats.clarificationRate)}`} />
        <KpiCard
          label="Propositions"
          value={stats.proposalsShown}
          sub={`${stats.proposalsConfirmed} conf. · ${stats.proposalsCancelled} ann.`}
        />
      </div>

      {/* ── Scope breakdown ────────────────────────────────────────────────── */}
      {scopeBreakdown.length > 0 && (
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Répartition par scope</p>
          <div className="space-y-1.5">
            {scopeBreakdown.map(({ scope, count, pct: p }) => (
              <div key={scope} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-xs text-muted-foreground">{scope}</span>
                <div className="flex-1 rounded-full bg-muted h-2">
                  <div className="h-2 rounded-full bg-brand-500" style={{ width: `${p}%` }} />
                </div>
                <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{count} ({p}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Perf rapide ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {stats.medianLatencyMs != null && <span>Latence médiane <strong className="text-foreground">{stats.medianLatencyMs} ms</strong></span>}
        {stats.p95LatencyMs != null && <span>P95 <strong className="text-foreground">{stats.p95LatencyMs} ms</strong></span>}
        <span>Clics réf. <strong className="text-foreground">{stats.totalReferenceClicks}</strong></span>
        {(stats.totalInputTokens + stats.totalOutputTokens) > 0
          ? <span>Coût estimé <strong className="text-foreground">{(stats.estimatedTotalCostEur * 119.33).toFixed(2)} XPF</strong></span>
          : <span className="italic">Coût <strong className="text-muted-foreground">non mesuré</strong></span>}
        {(stats.totalInputTokens + stats.totalOutputTokens) > 0
          ? <span>Tokens <strong className="text-foreground">{(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString('fr-FR')}</strong></span>
          : null}
      </div>

      {/* ── Filtres ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Période */}
        <div className="flex items-center rounded border bg-card overflow-hidden text-sm">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => nav({ days: d, page: 1 })}
              className={`px-3 py-1.5 transition-colors ${filters.days === d ? 'bg-foreground text-background font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {d}j
            </button>
          ))}
        </div>

        {/* Scope */}
        <select
          value={filters.scope ?? ''}
          onChange={(e) => nav({ scope: e.target.value || null, page: 1 })}
          className="rounded border bg-card px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">Tous les scopes</option>
          {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Answer status */}
        <select
          value={filters.answerStatus ?? ''}
          onChange={(e) => nav({ answerStatus: e.target.value || null, page: 1 })}
          className="rounded border bg-card px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">Tous statuts</option>
          {ANSWER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Answer mode */}
        <select
          value={filters.answerMode ?? ''}
          onChange={(e) => nav({ answerMode: e.target.value || null, page: 1 })}
          className="rounded border bg-card px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">Tous modes</option>
          {ANSWER_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        {/* Recherche */}
        <form
          onSubmit={(e) => { e.preventDefault(); nav({ q: searchDraft, page: 1 }) }}
          className="flex items-center gap-1"
        >
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Rechercher question…"
              className="rounded border bg-card pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 w-52"
            />
          </div>
          <button type="submit" className="rounded border bg-card px-3 py-1.5 text-sm hover:bg-muted">OK</button>
          {filters.search && (
            <button
              type="button"
              onClick={() => { setSearchDraft(''); nav({ q: '', page: 1 }) }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </form>
      </div>

      {/* ── Journal ────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          <p className="text-sm font-medium">Journal — {total} interaction{total > 1 ? 's' : ''}</p>
          {pageCount > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button
                disabled={filters.page <= 1}
                onClick={() => nav({ page: filters.page - 1 })}
                className="px-2 py-0.5 rounded border disabled:opacity-40 hover:bg-muted"
              >
                ‹
              </button>
              <span className="text-muted-foreground">{filters.page} / {pageCount}</span>
              <button
                disabled={filters.page >= pageCount}
                onClick={() => nav({ page: filters.page + 1 })}
                className="px-2 py-0.5 rounded border disabled:opacity-40 hover:bg-muted"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground italic">
            Aucune interaction dans cette période.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/20 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium w-28">Date</th>
                  <th className="px-3 py-2 text-left font-medium w-28">Site</th>
                  <th className="px-3 py-2 text-left font-medium">Question</th>
                  <th className="px-3 py-2 text-left font-medium w-16">Mode</th>
                  <th className="px-3 py-2 text-left font-medium w-28">Scope</th>
                  <th className="px-3 py-2 text-left font-medium w-24">Statut</th>
                  <th className="px-3 py-2 text-left font-medium w-20">Réponse</th>
                  <th className="px-3 py-2 text-right font-medium w-16">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setOpenId(row.id)}
                    className="cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                      {' '}
                      {new Date(row.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 text-xs truncate max-w-[7rem]" title={row.siteName ?? row.siteId ?? ''}>
                      {row.siteName ?? <span className="italic text-muted-foreground/60">—</span>}
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <span className="line-clamp-2 leading-snug">{row.question}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${row.conversationMode === 'guided' ? 'bg-slate-100 text-slate-700' : 'bg-slate-100 text-slate-500'}`}>
                        {row.conversationMode === 'guided' ? 'Guidé' : 'Libre'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{row.scope}</td>
                    <td className="px-3 py-2">{answerStatusBadge(row.answerStatus)}</td>
                    <td className="px-3 py-2">{answerModeBadge(row.answerMode)}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {row.latencyMs ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer */}
      <InteractionDrawer
        interactionId={openId}
        onClose={() => setOpenId(null)}
      />
    </>
  )
}
