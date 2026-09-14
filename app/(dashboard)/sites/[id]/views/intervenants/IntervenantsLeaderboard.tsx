'use client'

// ── PAGE INTERVENANTS (pilotage) — coquille ──────────────────────────────────
// Lot 3 (mandat Vincent 2026-09-14) : le tableau agrège désormais PAR ENTREPRISE
// CANONIQUE (lib/knowledge/site-intervenants-consolidated.ts, Lot 2A/2B), plus
// par personne — les doublons de nom (Clim Exp'Air/Clim'Expair) fusionnent, les
// compteurs d'activité comptent enfin l'Action portée par l'entreprise seule.
// Colonnes Engagements/Décisions/Obligations retirées (plus la bonne unité de
// lecture) ; un clic ouvre la fiche entreprise (4 blocs : À faire, Points,
// Présence chantier, Contacts). Les propositions IA (pipeline personne) restent
// une bannière de WORKFLOW séparée, inchangée.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFicheHref } from '@/components/knowledge/use-fiche-href'
import { Building2, ListChecks, Clock, MapPin, UserPlus, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConsolidatedIntervenant, SiteIntervenantsConsolidated } from '@/lib/knowledge/site-intervenants-consolidated'
import type { ToIdentifyItem } from '@/lib/knowledge/site-intervenants-view'
import { IdentifyCard } from './IdentifyCard'

function frDate(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

// KPI avec icône ronde colorée
function Kpi({ icon: Icon, label, value, sub, tint }: { icon: typeof Building2; label: string; value: number; sub: React.ReactNode; tint: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: `${tint}1a`, color: tint }}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[26px] font-bold leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-[13px] font-semibold">{label}</p>
        <p className="text-[11.5px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  )
}

type QuickFilter = 'all' | 'open' | 'late' | 'points'
type SortKey = 'actions' | 'late' | 'recent' | 'name'
const CHIPS: Array<{ key: QuickFilter; label: string }> = [
  { key: 'all', label: 'Toutes' }, { key: 'open', label: 'Actions ouvertes' },
  { key: 'late', label: 'En retard' }, { key: 'points', label: 'Points pilotés' },
]

export function IntervenantsLeaderboard({ siteId, consolidated, toIdentify }: {
  siteId: string
  consolidated: SiteIntervenantsConsolidated
  toIdentify: ToIdentifyItem[]
}) {
  const router = useRouter()
  const rows = consolidated.intervenants
  // Ouvrir une fiche entreprise garde l'onglet Intervenants derrière le panneau.
  const ficheHref = useFicheHref()
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState<QuickFilter>('all')
  const [sort, setSort] = useState<SortKey>('actions')
  const [showToId, setShowToId] = useState(false)

  const kpis = useMemo(() => ({
    companies: rows.length,
    openActions: rows.reduce((n, r) => n + r.actions.length, 0),
    lateActions: rows.reduce((n, r) => n + r.overdueActionsCount, 0),
    pointsPiloted: rows.reduce((n, r) => n + r.pointsPiloted.length, 0),
  }), [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = rows.filter((r) => {
      if (chip === 'open' && r.actions.length === 0) return false
      if (chip === 'late' && r.overdueActionsCount === 0) return false
      if (chip === 'points' && r.pointsPiloted.length === 0) return false
      if (q && !r.companyName.toLowerCase().includes(q)) return false
      return true
    })
    const byName = (a: ConsolidatedIntervenant, b: ConsolidatedIntervenant) => a.companyName.localeCompare(b.companyName, 'fr') || a.companyId.localeCompare(b.companyId)
    return [...out].sort((a, b) => {
      if (sort === 'name') return byName(a, b)
      if (sort === 'late') return b.overdueActionsCount - a.overdueActionsCount || byName(a, b)
      if (sort === 'recent') return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '') || byName(a, b)
      return b.actions.length - a.actions.length || b.overdueActionsCount - a.overdueActionsCount || byName(a, b)
    })
  }, [rows, search, chip, sort])

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intervenants</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Les entreprises qui interviennent sur ce chantier et leurs engagements.</p>
        </div>
        <div className="flex min-w-[220px] items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[13px]">
          <span className="text-muted-foreground">🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une entreprise…"
            className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
      </header>

      {/* KPIs — calculés depuis les mêmes lignes que le tableau */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Building2} label="Entreprises" value={kpis.companies} tint="#3b82f6" sub="au casting de ce chantier" />
        <Kpi icon={ListChecks} label="Actions ouvertes" value={kpis.openActions} tint="#6366f1" sub="tous statuts confondus" />
        <Kpi icon={Clock} label="En retard" value={kpis.lateActions} tint="#f59e0b" sub="échéance dépassée" />
        <Kpi icon={MapPin} label="Points pilotés" value={kpis.pointsPiloted} tint="#10b981" sub="désignation humaine explicite" />
      </section>

      {/* Bannière WORKFLOW « À identifier » — pipeline IA, SÉPARÉE du leaderboard */}
      {toIdentify.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><UserPlus className="h-4 w-4" /></span>
              <div className="text-[13px]">
                <b className="font-semibold">À identifier</b>
                <p className="text-muted-foreground">{toIdentify.length} personne{toIdentify.length > 1 ? 's' : ''} {toIdentify.length > 1 ? 'ont' : 'a'} été citée{toIdentify.length > 1 ? 's' : ''} par l’IA dans des visites ou réunions et attend{toIdentify.length > 1 ? 'ent' : ''} validation.</p>
              </div>
            </div>
            <button onClick={() => setShowToId((v) => !v)} className="shrink-0 rounded-lg border border-amber-300 bg-card px-3 py-1.5 text-[12.5px] font-semibold text-amber-800 hover:bg-amber-100/50 dark:border-amber-800 dark:text-amber-200">
              {showToId ? 'Masquer' : 'Voir les propositions'} <ChevronRight className="ml-0.5 inline h-3.5 w-3.5" />
            </button>
          </div>
          {showToId && (
            /* Le geste vient de l'onglet Intervenants : citer un nom ne sert à
               rien si on ne peut pas le confirmer là où on le lit. */
            <ul className="space-y-1.5 border-t border-amber-200/70 px-4 py-2.5 dark:border-amber-900/40">
              {toIdentify.map((p) => (
                <IdentifyCard key={p.proposalId} siteId={siteId} item={p} onDone={() => router.refresh()} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Chips de filtre rapide + tri */}
      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button key={c.key} onClick={() => setChip(c.key)}
            className={cn('rounded-lg border px-3 py-1.5 text-[12.5px]', chip === c.key ? 'border-foreground bg-foreground text-background font-medium' : 'bg-card text-muted-foreground hover:text-foreground')}>
            {c.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span>Trier par</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border bg-card px-2.5 py-1.5">
            <option value="actions">Actions ouvertes</option>
            <option value="late">Retards</option>
            <option value="recent">Dernière activité</option>
            <option value="name">Nom</option>
          </select>
        </div>
      </div>

      {/* Leaderboard — par entreprise canonique */}
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="border-b text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-left font-semibold">Intervenant</th>
              <th className="px-3 py-3 text-left font-semibold">Rôles</th>
              <th className="px-3 py-3 text-center font-semibold">Actions ouvertes</th>
              <th className="px-3 py-3 text-center font-semibold">Points pilotés</th>
              <th className="px-3 py-3 text-center font-semibold">Retard</th>
              <th className="px-4 py-3 text-left font-semibold">Dernière activité</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const roles = [...new Set(r.casting.map((c) => formatRole(c.role)))]
              const href = ficheHref(`/sites/${siteId}/entreprise/${r.companyId}`) ?? `/sites/${siteId}/entreprise/${r.companyId}`
              return (
                <tr key={r.companyId} className="group border-b border-border/50 last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={href} scroll={false} className="flex items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary"><Building2 className="h-4 w-4" /></span>
                      <b className="min-w-0 truncate text-[13.5px] font-semibold">{r.companyName}</b>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">{roles.length > 0 ? roles.join(' · ') : '—'}</td>
                  <td className="px-3 py-3 text-center text-[14px] font-semibold tabular-nums">{r.actions.length}</td>
                  <td className={cn('px-3 py-3 text-center text-[14px] font-semibold tabular-nums', r.pointsPiloted.length === 0 && 'font-normal text-muted-foreground/50')}>{r.pointsPiloted.length}</td>
                  <td className="px-3 py-3 text-center text-[14px] font-semibold tabular-nums">
                    {r.overdueActionsCount > 0
                      ? <span className="text-rose-600 dark:text-rose-400">{r.overdueActionsCount}</span>
                      : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-muted-foreground">{frDate(r.lastActivityAt)}</td>
                  <td className="pr-3 text-right"><ChevronRight className="inline h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground" /></td>
                </tr>
              )
            })}
            {visible.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">Aucune entreprise ne correspond à ces filtres.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Ce qui alimente la page — la frontière de la connaissance, rendue explicite */}
      <div className="grid gap-4 rounded-xl border bg-card p-4 text-[11.5px] shadow-sm md:grid-cols-3">
        <div>
          <p className="mb-1.5 font-semibold">Ce qui alimente cette page (100 % factuel)</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><span className="text-emerald-600">✓</span> Casting intervenants (rôles, entreprises, périodes)</li>
            <li><span className="text-emerald-600">✓</span> Actions assignées à l’entreprise ou à l’un de ses contacts (ouvertes, en retard)</li>
            <li><span className="text-emerald-600">✓</span> Points pilotés (désignation humaine explicite)</li>
          </ul>
        </div>
        <div>
          <p className="mb-1.5 font-semibold">Mentions confirmées (IA validée par l’humain)</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><span className="text-emerald-600">✓</span> Contacts rattachés à l’entreprise (annuaire complet)</li>
          </ul>
        </div>
        <div>
          <p className="mb-1.5 font-semibold">Hors scope pour le moment</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><span className="text-rose-500">✗</span> Points où citée (détection textuelle non batchée sur un site entier)</li>
            <li><span className="text-rose-500">✗</span> Présence à des visites/réunions (participants non structurés)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
