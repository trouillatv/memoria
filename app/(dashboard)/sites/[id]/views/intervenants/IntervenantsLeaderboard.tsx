'use client'

// ── PAGE INTERVENANTS (pilotage) — Intervenants V2 ───────────────────────────
// Mandat Vincent 2026-09-14 (GO accélération) : faire de cet onglet une vraie
// vue de pilotage des acteurs, pas un annuaire à zéros. Le tableau plat cède la
// place à une hiérarchie à 4 niveaux (En retard / Engagements actifs / Sans
// activité récente / Cités-castés sans engagement), calculée uniquement à partir
// de champs déjà datés du read-model consolidé (lib/knowledge/site-intervenants-consolidated.ts,
// Lot 2A/2B/3) — aucune catégorie sans substrat mesuré. Une ligne = une carte
// responsive (flex-col mobile → flex-row desktop), jamais un tableau comprimé.
// Un clic/tap ouvre la fiche entreprise (À faire, Décisions, Obligations,
// Points, Présence chantier, Contacts). Les propositions IA (pipeline personne)
// restent une bannière de WORKFLOW séparée, inchangée.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFicheHref } from '@/components/knowledge/use-fiche-href'
import { Building2, ListChecks, Clock, MapPin, UserPlus, ChevronRight } from 'lucide-react'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'
import type { ConsolidatedIntervenant, SiteIntervenantsConsolidated } from '@/lib/knowledge/site-intervenants-consolidated'
import type { ToIdentifyItem } from '@/lib/knowledge/site-intervenants-view'
import { IdentifyCard } from './IdentifyCard'
import { CompanyAvatar } from '@/app/(dashboard)/intervenants/fiche-ui'

const STALE_AFTER_DAYS = 30 // même seuil que site_visit_stale/longNoVisitBoost (cohérence transverse)

function frDate(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}

function formatRole(role: string | null): string {
  if (!role) return 'Rôle à préciser'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function hasActiveEngagement(r: ConsolidatedIntervenant): boolean {
  return r.actions.length > 0 || r.decisions.length > 0 || r.openObligationsCount > 0 || r.pointsPiloted.length > 0
}

function engagementScore(r: ConsolidatedIntervenant): number {
  return r.actions.length + r.decisions.length + r.openObligationsCount + r.pointsPiloted.length
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

const BUCKET_ACCENT = {
  rose: 'border-rose-200 dark:border-rose-900/40',
  default: 'border-border/60',
  muted: 'border-border/60',
} as const

/** Une carte responsive — flex-col sur mobile, flex-row sur desktop. Un seul
 *  balisage pour les deux tailles (pas de duplication table/carte). */
function IntervenantRow({ r, siteId, ficheHref }: {
  r: ConsolidatedIntervenant
  siteId: string
  ficheHref: (href: string) => string | null
}) {
  const roles = [...new Set(r.casting.map((c) => formatRole(c.role)))]
  const href = ficheHref(`/sites/${siteId}/entreprise/${r.companyId}`) ?? `/sites/${siteId}/entreprise/${r.companyId}`
  const engagementParts = [
    r.actions.length > 0 ? `${r.actions.length} action${r.actions.length > 1 ? 's' : ''}` : null,
    r.decisions.length > 0 ? `${r.decisions.length} décision${r.decisions.length > 1 ? 's' : ''}` : null,
    r.openObligationsCount > 0 ? `${r.openObligationsCount} obligation${r.openObligationsCount > 1 ? 's' : ''}` : null,
    r.pointsPiloted.length > 0 ? `${r.pointsPiloted.length} Point${r.pointsPiloted.length > 1 ? 's' : ''} piloté${r.pointsPiloted.length > 1 ? 's' : ''}` : null,
  ].filter((v): v is string => v !== null)

  return (
    <Link href={href} scroll={false}
      className="group flex flex-col gap-2 rounded-xl border bg-card px-4 py-2.5 shadow-sm transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-3.5">
      <CompanyAvatar name={r.companyName} companyId={r.companyId} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b className="min-w-0 truncate text-[13.5px] font-semibold">{r.companyName}</b>
          <span className="text-[12px] text-muted-foreground">{roles.length > 0 ? roles.join(' · ') : 'Rôle non précisé'}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {engagementParts.length > 0 ? (
            engagementParts.map((part) => (
              <span key={part} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{part}</span>
            ))
          ) : (
            <span className="text-[12px] text-muted-foreground">Aucun engagement actif</span>
          )}
          {r.overdueActionsCount > 0 && (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950/30 dark:text-rose-400">
              {r.overdueActionsCount} en retard
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5 text-[11.5px] text-muted-foreground">
        <span>Dernière activité {frDate(r.lastActivityAt)}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
      </div>
    </Link>
  )
}

function IntervenantBucket({ title, hint, items, siteId, ficheHref, accent }: {
  title: string
  hint: string
  items: ConsolidatedIntervenant[]
  siteId: string
  ficheHref: (href: string) => string | null
  accent: keyof typeof BUCKET_ACCENT
}) {
  if (items.length === 0) return null
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{items.length}</span>
        <span className="text-[11.5px] text-muted-foreground">{hint}</span>
      </div>
      <div className={`space-y-2 rounded-2xl border border-dashed p-2 ${BUCKET_ACCENT[accent]}`}>
        {items.map((r) => <IntervenantRow key={r.companyId} r={r} siteId={siteId} ficheHref={ficheHref} />)}
      </div>
    </section>
  )
}

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
  const [showToId, setShowToId] = useState(false)

  const kpis = useMemo(() => ({
    companies: rows.length,
    openActions: rows.reduce((n, r) => n + r.actions.length, 0),
    lateActions: rows.reduce((n, r) => n + r.overdueActionsCount, 0),
    pointsPiloted: rows.reduce((n, r) => n + r.pointsPiloted.length, 0),
  }), [rows])

  // Hiérarchie à 4 niveaux — répond en un coup d'œil à « qui a du travail / qui
  // est en retard / qui est simplement cité ». Aucun scoring inventé : chaque
  // bucket dérive de champs déjà réels et datés du read-model.
  const buckets = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q ? rows.filter((r) => r.companyName.toLowerCase().includes(q)) : rows
    const staleThreshold = addDaysLocal(todayLocalIso(), -STALE_AFTER_DAYS)
    const byName = (a: ConsolidatedIntervenant, b: ConsolidatedIntervenant) => a.companyName.localeCompare(b.companyName, 'fr') || a.companyId.localeCompare(b.companyId)

    const late: ConsolidatedIntervenant[] = []
    const active: ConsolidatedIntervenant[] = []
    const stale: ConsolidatedIntervenant[] = []
    const cited: ConsolidatedIntervenant[] = []
    for (const r of filtered) {
      if (r.overdueActionsCount > 0) { late.push(r); continue }
      if (hasActiveEngagement(r)) { active.push(r); continue }
      if (r.lastActivityAt && r.lastActivityAt < staleThreshold) { stale.push(r); continue }
      cited.push(r)
    }
    late.sort((a, b) => b.overdueActionsCount - a.overdueActionsCount || byName(a, b))
    active.sort((a, b) => engagementScore(b) - engagementScore(a) || byName(a, b))
    stale.sort(byName)
    cited.sort(byName)
    return { late, active, stale, cited }
  }, [rows, search])

  const totalVisible = buckets.late.length + buckets.active.length + buckets.stale.length + buckets.cited.length

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

      {/* Hiérarchie des intervenants — 4 niveaux, aucun tableau comprimé (recherche déjà dans le header) */}
      <div className="space-y-5">
        <IntervenantBucket title="En retard" hint="Échéance dépassée sur au moins une Action portée" items={buckets.late} siteId={siteId} ficheHref={ficheHref} accent="rose" />
        <IntervenantBucket title="Engagements actifs" hint="Actions, décisions, obligations ou Points portés" items={buckets.active} siteId={siteId} ficheHref={ficheHref} accent="default" />
        <IntervenantBucket title="Sans activité récente" hint={`Aucune mention depuis plus de ${STALE_AFTER_DAYS} jours`} items={buckets.stale} siteId={siteId} ficheHref={ficheHref} accent="muted" />
        <IntervenantBucket title="Cités ou castés, sans engagement" hint="Présents au casting du chantier, aucune charge en cours" items={buckets.cited} siteId={siteId} ficheHref={ficheHref} accent="muted" />
        {totalVisible === 0 && (
          <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-sm">
            Aucune entreprise ne correspond à cette recherche.
          </div>
        )}
      </div>

      {/* Ce qui alimente la page — provenance/transparence technique. Utile en
          recette, pas en pilotage quotidien : repliée par défaut (recette
          Vincent 2026-09-15). */}
      <details className="rounded-xl border bg-card p-4 text-[11.5px] shadow-sm">
        <summary className="cursor-pointer select-none font-semibold text-muted-foreground">
          Comment cette page est calculée
        </summary>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div>
            <p className="mb-1.5 font-semibold">Ce qui alimente cette page (100 % factuel)</p>
            <ul className="space-y-1 text-muted-foreground">
              <li><span className="text-emerald-600">✓</span> Casting intervenants (rôles, entreprises, périodes)</li>
              <li><span className="text-emerald-600">✓</span> Actions assignées à l’entreprise ou à l’un de ses contacts (ouvertes, en retard)</li>
              <li><span className="text-emerald-600">✓</span> Décisions actives portées par l’entreprise ou l’un de ses contacts</li>
              <li><span className="text-emerald-600">✓</span> Obligations ouvertes portées via un contact (compte seul, pas encore de fiche dédiée)</li>
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
              <li><span className="text-rose-500">✗</span> Nombre de chantiers (résolution d’alias org-wide non construite, signal secondaire)</li>
            </ul>
          </div>
        </div>
      </details>
    </div>
  )
}
