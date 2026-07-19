'use client'

// ── PAGE INTERVENANTS (pilotage) — coquille ──────────────────────────────────
// Présentationnel pur : tout vient de buildIntervenantsDashboard (projection de
// la vue existante). Le leaderboard ne montre que les VALIDÉS ; les propositions
// (pipeline IA) vivent dans un encart de WORKFLOW séparé — jamais mêlées. Un clic
// sur une ligne ouvre la FICHE existante (?person=), on ne recrée rien.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { IntervenantsDashboard, IntervenantRow } from '@/lib/knowledge/intervenants-dashboard-model'
import type { ToIdentifyItem } from '@/lib/knowledge/site-intervenants-view'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·'
function frDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}
function relDays(days: number | null): string {
  if (days === null) return ''
  if (days <= 0) return "aujourd’hui"
  if (days === 1) return 'il y a 1 jour'
  if (days < 30) return `il y a ${days} jours`
  const mo = Math.floor(days / 30)
  return mo === 1 ? 'il y a 1 mois' : `il y a ${mo} mois`
}

function Kpi({ label, value, accent, sub, hero }: { label: string; value: number; accent: string; sub: React.ReactNode; hero?: boolean }) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm', hero && 'bg-primary/5')}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: accent }}>{label}</p>
      <p className="mt-1 text-[30px] font-bold leading-none tabular-nums">{value}</p>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">{sub}</p>
    </div>
  )
}

const Metric = ({ n, unit, zero }: { n: number; unit: string; zero?: boolean }) => (
  <span className="inline-flex flex-col items-center leading-tight">
    <span className={cn('text-[15px] font-bold', (zero ?? n === 0) && 'font-medium text-muted-foreground/60')}>{n}</span>
    <span className="text-[10px] text-muted-foreground/70">{unit}</span>
  </span>
)

export function IntervenantsLeaderboard({ dashboard, toIdentify }: { dashboard: IntervenantsDashboard; toIdentify: ToIdentifyItem[] }) {
  const { rows, kpis } = dashboard
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [showToId, setShowToId] = useState(false)

  const companies = useMemo(() => [...new Set(rows.map((r) => r.companyName))].sort((a, b) => a.localeCompare(b, 'fr')), [rows])
  const roles = useMemo(() => [...new Set(rows.map((r) => r.role))].sort((a, b) => a.localeCompare(b, 'fr')), [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (company && r.companyName !== company) return false
      if (role && r.role !== role) return false
      if (q && !`${r.name} ${r.role} ${r.companyName}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, search, company, role])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Intervenants</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Le réseau humain du chantier — la relation, racontée par les engagements. Pas un annuaire.</p>
      </header>

      {/* KPIs — calculés depuis les mêmes lignes que le tableau */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi hero label="Engagements actifs" value={kpis.engagementsActifs} accent="#2563eb"
          sub={<>portés par {kpis.validatedCount} intervenant{kpis.validatedCount > 1 ? 's' : ''}</>} />
        <Kpi label="En retard" value={kpis.lateTotal} accent="#e11d48"
          sub={<>{kpis.latePeople} personne{kpis.latePeople > 1 ? 's' : ''} concernée{kpis.latePeople > 1 ? 's' : ''}</>} />
        <Kpi label="Sans activité récente" value={kpis.idleCount} accent="#d97706" sub="> 30 jours" />
        <Kpi label="Sur plusieurs chantiers" value={kpis.multiSiteCount} accent="#4f46e5" sub="intervenants transverses" />
      </section>

      {/* Encart WORKFLOW « À identifier » — pipeline IA, séparé du leaderboard */}
      {toIdentify.length > 0 && (
        <div className="rounded-lg border border-dashed">
          <button onClick={() => setShowToId((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left">
            <span className="text-[12.5px] text-muted-foreground">
              <b className="mr-2 font-semibold text-foreground">À identifier</b>
              {toIdentify.length} personne{toIdentify.length > 1 ? 's' : ''} citée{toIdentify.length > 1 ? 's' : ''} attend{toIdentify.length > 1 ? 'ent' : ''} une validation — pas encore dans la connaissance du chantier.
            </span>
            <span className="shrink-0 text-[12.5px] font-semibold text-primary">{showToId ? 'Masquer' : 'Examiner'} →</span>
          </button>
          {showToId && (
            <ul className="border-t border-dashed px-4 py-2.5 space-y-1.5">
              {toIdentify.map((p) => (
                <li key={p.proposalId} className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-medium">{p.title}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    cité{p.visitDates[0] ? ` — visite du ${frDate(p.visitDates[0])}` : ''}
                    {p.suggestion ? ` · correspond peut-être à ${p.suggestion.name}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap gap-2">
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-[13px]">
          <span className="text-muted-foreground">🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un intervenant, une entreprise, un rôle…"
            className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
        <select value={company ?? ''} onChange={(e) => setCompany(e.target.value || null)} className="rounded-lg border bg-card px-2.5 py-1.5 text-[13px] text-muted-foreground">
          <option value="">Entreprise</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={role ?? ''} onChange={(e) => setRole(e.target.value || null)} className="rounded-lg border bg-card px-2.5 py-1.5 text-[13px] text-muted-foreground">
          <option value="">Rôle</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Leaderboard — comparer d'un coup d'œil qui porte quoi (validés uniquement) */}
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-left font-semibold">Intervenant</th>
              <th className="px-3 py-3 text-center font-semibold">Engagements</th>
              <th className="px-3 py-3 text-center font-semibold">Actions</th>
              <th className="px-3 py-3 text-center font-semibold">Décisions</th>
              <th className="px-3 py-3 text-center font-semibold">Obligations</th>
              <th className="px-4 py-3 text-left font-semibold">Cité dans</th>
              <th className="px-4 py-3 text-right font-semibold">Dernière activité</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r: IntervenantRow) => (
              <tr key={r.intervenantId} className="border-b border-border/50 last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link href={r.href} scroll={false} className="flex items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(r.name)}</span>
                    <span className="min-w-0"><b className="text-[13.5px] font-semibold">{r.name}</b><span className="block text-[11px] text-muted-foreground">{r.role} · {r.companyName}</span></span>
                  </Link>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex items-baseline gap-1"><span className="text-[16px] font-bold text-primary tabular-nums">{r.engagementsActifs}</span><span className="text-[10px] text-muted-foreground/70">actif{r.engagementsActifs > 1 ? 's' : ''}</span></span>
                </td>
                <td className="px-3 py-3 text-center">
                  <Metric n={r.openActions} unit="ouvertes" />
                  {r.lateActions > 0 && <span className="mt-0.5 block text-[10.5px] font-semibold text-rose-600 dark:text-rose-400">{r.lateActions} en retard</span>}
                </td>
                <td className="px-3 py-3 text-center"><Metric n={r.decisionsCount} unit={r.decisionsCount > 1 ? 'portées' : 'portée'} /></td>
                <td className="px-3 py-3 text-center"><Metric n={r.openObligationsCount} unit={r.openObligationsCount > 1 ? 'ouvertes' : 'ouverte'} /></td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground">cité dans {r.citedVisitsCount} visite{r.citedVisitsCount > 1 ? 's' : ''}</td>
                <td className="px-4 py-3 text-right text-[12px]">
                  <span className="tabular-nums">{frDate(r.lastActivity)}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{relDays(r.daysSinceActivity)}</span>
                  <span className="mt-1 inline-flex flex-wrap justify-end gap-1">
                    {r.isIdle && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">⚠ inactif</span>}
                    {r.isMultiSite && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">🏗 {r.otherSitesCount + 1} chantiers</span>}
                  </span>
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">Aucun intervenant ne correspond à ces filtres.</td></tr>}
          </tbody>
        </table>
        <div className="border-t px-4 py-2.5 text-[12px] text-muted-foreground">{visible.length} intervenant{visible.length > 1 ? 's' : ''} validé{visible.length > 1 ? 's' : ''} · un clic ouvre la fiche</div>
      </div>
    </div>
  )
}
