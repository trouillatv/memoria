'use client'

// ── PAGE INTERVENANTS (pilotage) — coquille ──────────────────────────────────
// Présentationnel pur : tout vient de buildIntervenantsDashboard (projection de
// la vue existante). Le leaderboard ne montre que les VALIDÉS ; les propositions
// (pipeline IA) vivent dans une bannière de WORKFLOW séparée. Un clic sur une
// ligne ouvre la FICHE existante (?person=), on ne recrée rien.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFicheHref } from '@/components/knowledge/use-fiche-href'
import { Users, Clock, PauseCircle, Building2, UserPlus, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IntervenantsDashboard, IntervenantRow } from '@/lib/knowledge/intervenants-dashboard-model'
import type { ToIdentifyItem } from '@/lib/knowledge/site-intervenants-view'
import { IdentifyCard } from './IdentifyCard'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·'
function frDate(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}
function relDays(days: number | null): string {
  if (days === null) return ''
  if (days <= 0) return "aujourd’hui"
  if (days === 1) return 'hier'
  if (days < 30) return `il y a ${days} jours`
  const mo = Math.floor(days / 30)
  return mo === 1 ? 'il y a 1 mois' : `il y a ${mo} mois`
}

// KPI avec icône ronde colorée
function Kpi({ icon: Icon, label, value, sub, tint }: { icon: typeof Users; label: string; value: number; sub: React.ReactNode; tint: string }) {
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

// Barre de points : engagements relatifs au plus engagé
function Dots({ n, max }: { n: number; max: number }) {
  const total = 8
  const filled = max > 0 ? Math.min(total, Math.round((n / max) * total)) : 0
  return (
    <span className="mt-1 flex gap-[3px]">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn('h-1.5 w-1.5 rounded-full', i < filled ? 'bg-primary' : 'bg-muted')} />
      ))}
    </span>
  )
}

type QuickFilter = 'all' | 'open' | 'late' | 'idle' | 'multi'
type SortKey = 'engagements' | 'late' | 'recent' | 'name'
const CHIPS: Array<{ key: QuickFilter; label: string }> = [
  { key: 'all', label: 'Tous' }, { key: 'open', label: 'Actions ouvertes' },
  { key: 'late', label: 'En retard' }, { key: 'idle', label: 'Sans activité' }, { key: 'multi', label: 'Multi-chantiers' },
]

export function IntervenantsLeaderboard({ siteId, dashboard, toIdentify }: { siteId: string; dashboard: IntervenantsDashboard; toIdentify: ToIdentifyItem[] }) {
  const router = useRouter()
  const { rows, kpis } = dashboard
  // Ouvrir une fiche personne garde l'onglet Intervenants derrière le panneau.
  const ficheHref = useFicheHref()
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState<string | null>(null)
  const [chip, setChip] = useState<QuickFilter>('all')
  const [sort, setSort] = useState<SortKey>('engagements')
  const [showToId, setShowToId] = useState(false)

  const companies = useMemo(() => [...new Set(rows.map((r) => r.companyName))].sort((a, b) => a.localeCompare(b, 'fr')), [rows])
  const maxEng = useMemo(() => Math.max(1, ...rows.map((r) => r.engagementsActifs)), [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = rows.filter((r) => {
      if (company && r.companyName !== company) return false
      if (chip === 'open' && r.openActions === 0) return false
      if (chip === 'late' && r.lateActions === 0) return false
      if (chip === 'idle' && !r.isIdle) return false
      if (chip === 'multi' && !r.isMultiSite) return false
      if (q && !`${r.name} ${r.role} ${r.companyName}`.toLowerCase().includes(q)) return false
      return true
    })
    // Tri client déterministe (le read model tri déjà par engagements ; ici l'utilisateur choisit).
    const byName = (a: IntervenantRow, b: IntervenantRow) => a.name.localeCompare(b.name, 'fr') || a.intervenantId.localeCompare(b.intervenantId)
    return [...out].sort((a, b) => {
      if (sort === 'name') return byName(a, b)
      if (sort === 'late') return b.lateActions - a.lateActions || b.engagementsActifs - a.engagementsActifs || byName(a, b)
      if (sort === 'recent') return (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') || byName(a, b)
      return b.engagementsActifs - a.engagementsActifs || b.lateActions - a.lateActions || byName(a, b)
    })
  }, [rows, search, company, chip, sort])

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intervenants</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Les personnes qui interviennent sur ce chantier et leurs engagements.</p>
        </div>
        <div className="flex min-w-[220px] items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[13px]">
          <span className="text-muted-foreground">🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un intervenant…"
            className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
      </header>

      {/* KPIs — calculés depuis les mêmes lignes que le tableau */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Users} label="Engagements actifs" value={kpis.engagementsActifs} tint="#6366f1"
          sub={<>portés par {kpis.validatedCount} personne{kpis.validatedCount > 1 ? 's' : ''} · <span className="text-primary">= actions ouvertes + obligations</span></>} />
        <Kpi icon={Clock} label="En retard" value={kpis.lateTotal} tint="#f59e0b" sub={`${kpis.latePeople} personne${kpis.latePeople > 1 ? 's' : ''} concernée${kpis.latePeople > 1 ? 's' : ''}`} />
        <Kpi icon={PauseCircle} label="Sans activité récente" value={kpis.idleCount} tint="#64748b" sub="depuis plus de 30 jours" />
        <Kpi icon={Building2} label="Sur plusieurs chantiers" value={kpis.multiSiteCount} tint="#3b82f6" sub="interviennent ailleurs" />
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
        <select value={company ?? ''} onChange={(e) => setCompany(e.target.value || null)} className="rounded-lg border bg-card px-2.5 py-1.5 text-[12.5px] text-muted-foreground">
          <option value="">Entreprise</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span>Trier par</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border bg-card px-2.5 py-1.5">
            <option value="engagements">Engagements</option>
            <option value="late">Retards</option>
            <option value="recent">Dernière activité</option>
            <option value="name">Nom</option>
          </select>
        </div>
      </div>

      {/* Leaderboard — validés uniquement */}
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-left font-semibold">Intervenant</th>
              <th className="px-3 py-3 text-left font-semibold">Engagements</th>
              <th className="px-3 py-3 text-center font-semibold">Actions<span className="block font-normal normal-case text-[9.5px] text-muted-foreground/70">ouvertes (retard)</span></th>
              <th className="px-3 py-3 text-center font-semibold">Décisions<span className="block font-normal normal-case text-[9.5px] text-muted-foreground/70">portées</span></th>
              <th className="px-3 py-3 text-center font-semibold">Obligations</th>
              <th className="px-4 py-3 text-left font-semibold">Cité dans<span className="block font-normal normal-case text-[9.5px] text-muted-foreground/70">N visites</span></th>
              <th className="px-4 py-3 text-left font-semibold">Dernière activité</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r: IntervenantRow) => (
              <tr key={r.intervenantId} className="group border-b border-border/50 last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link href={ficheHref(r.href) ?? r.href} scroll={false} className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(r.name)}</span>
                    <span className="min-w-0"><b className="text-[13.5px] font-semibold">{r.name}</b><span className="block text-[11px] text-muted-foreground">{r.role} · {r.companyName}</span></span>
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <span className="text-[16px] font-bold tabular-nums">{r.engagementsActifs}</span>
                  <Dots n={r.engagementsActifs} max={maxEng} />
                </td>
                <td className="px-3 py-3 text-center text-[14px] font-semibold tabular-nums">
                  {r.openActions}{r.lateActions > 0 && <span className="text-rose-600 dark:text-rose-400"> ({r.lateActions})</span>}
                </td>
                <td className={cn('px-3 py-3 text-center text-[14px] font-semibold tabular-nums', r.decisionsCount === 0 && 'font-normal text-muted-foreground/50')}>{r.decisionsCount}</td>
                <td className={cn('px-3 py-3 text-center text-[14px] font-semibold tabular-nums', r.openObligationsCount === 0 && 'font-normal text-muted-foreground/50')}>{r.openObligationsCount}</td>
                <td className="px-4 py-3 text-[14px] font-semibold tabular-nums">{r.citedVisitsCount}<span className="ml-1 text-[11px] font-normal text-muted-foreground">visite{r.citedVisitsCount > 1 ? 's' : ''}</span></td>
                <td className="px-4 py-3 text-[12.5px]">
                  <span>{relDays(r.daysSinceActivity) || frDate(r.lastActivity)}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {r.isIdle && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">⚠ Inactif</span>}
                    {r.isMultiSite && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">🏗 Multi</span>}
                  </span>
                </td>
                <td className="pr-3 text-right"><ChevronRight className="inline h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground" /></td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">Aucun intervenant ne correspond à ces filtres.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Ce qui alimente la page — la frontière de la connaissance, rendue explicite */}
      <div className="grid gap-4 rounded-xl border bg-card p-4 text-[11.5px] shadow-sm md:grid-cols-3">
        <div>
          <p className="mb-1.5 font-semibold">Ce qui alimente cette page (100 % factuel)</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><span className="text-emerald-600">✓</span> Casting intervenants (rôles, entreprises, périodes)</li>
            <li><span className="text-emerald-600">✓</span> Actions assignées (ouvertes, en retard)</li>
            <li><span className="text-emerald-600">✓</span> Décisions portées · obligations · dernière activité · autres chantiers</li>
          </ul>
        </div>
        <div>
          <p className="mb-1.5 font-semibold">Mentions confirmées (IA validée par l’humain)</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><span className="text-emerald-600">✓</span> Personne citée dans N visites / comptes rendus</li>
          </ul>
        </div>
        <div>
          <p className="mb-1.5 font-semibold">Hors scope pour le moment</p>
          <ul className="space-y-1 text-muted-foreground">
            <li><span className="text-rose-500">✗</span> Présence à des visites/réunions (participants non structurés)</li>
            <li><span className="text-rose-500">✗</span> Réserves (pas de lien personne)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
