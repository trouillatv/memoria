'use client'

// ── PILOTAGE DES ACTIONS — coquille (Tranche 1 + pass hiérarchie) ────────────
// Présentationnel pur : tout vient de getActionsDashboard. La LIGNE est l'objet
// que le chef d'équipe lit 95 % du temps → elle raconte une histoire (quoi ·
// pourquoi · qui · pour quand). KPIs compacts sur une ligne, filtres collants,
// onglets discrets. Aucune fonction hors-tranche (priorité/relance/affectation).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  ACTION_STATUS_LABEL, inTab, applyActionFilters, isOverdue, daysUntil,
  type ActionDashboardItem, type ActionOrigin, type ActionListStatus, type ActionTab,
} from '@/lib/knowledge/actions-dashboard-model'
import type { ActionsDashboard as Data } from '@/lib/knowledge/actions-dashboard'

const ORIGIN_LABEL: Record<ActionOrigin['type'], string> = { reunion: 'Réunion', visite: 'Visite', reserve: 'Réserve', sujet: 'Sujet' }
// Pastille couleur par type — l'ADN MemorIA : chaque action rattachée à un fait réel.
const ORIGIN_DOT: Record<ActionOrigin['type'], string> = {
  reunion: '#6366f1', visite: '#10b981', reserve: '#f43f5e', sujet: '#0ea5e9',
}

const STATUS_CLS: Record<ActionListStatus, string> = {
  open: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  planned: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  cancelled: 'bg-muted text-muted-foreground ring-border',
}

function frDue(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// ── KPI compact : presque une phrase, sur une seule ligne (desktop) ──
function Kpi({ label, value, accent, sub }: { label: string; value: number; accent: string; sub: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-3.5 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-[22px] font-bold leading-none tabular-nums">{value}</span>
        <span className="text-[11.5px] text-muted-foreground leading-tight">{sub}</span>
      </div>
    </div>
  )
}

const TABS: Array<{ key: ActionTab; label: string }> = [
  { key: 'all', label: 'Toutes' },
  { key: 'active', label: 'Actives' },
  { key: 'overdue', label: 'En retard' },
  { key: 'done_no_proof', label: 'Sans preuve' },
  { key: 'done', label: 'Terminées' },
]

export function ActionsDashboard({ data, today }: { data: Data; today: string }) {
  const { summary, actions, filters } = data
  const [tab, setTab] = useState<ActionTab>('all')
  const [search, setSearch] = useState('')
  const [responsibleName, setResponsible] = useState<string | null>(null)
  const [originType, setOrigin] = useState<ActionOrigin['type'] | null>(null)
  const [status, setStatus] = useState<ActionListStatus | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  // « Regrouper par chantier » : optionnel (jamais imposé — sinon la page devient
  // très verticale avec beaucoup de chantiers), dernier choix mémorisé.
  const [groupBySite, setGroupBySite] = useState(false)
  useEffect(() => {
    // Lecture POST-montage volontaire : le serveur ne connaît pas localStorage, la
    // lire à l'init provoquerait un décalage d'hydratation. D'où le setState ici.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setGroupBySite(localStorage.getItem('actions:groupBySite') === '1') } catch { /* localStorage indispo */ }
  }, [])
  function toggleGroupBySite() {
    setGroupBySite((v) => {
      const next = !v
      try { localStorage.setItem('actions:groupBySite', next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }

  const tabCounts = useMemo(() => {
    const c: Record<ActionTab, number> = { all: 0, active: 0, overdue: 0, done_no_proof: 0, done: 0 }
    for (const t of TABS) c[t.key] = actions.filter((a) => inTab(a, today, t.key)).length
    return c
  }, [actions, today])

  const rows = useMemo(() => {
    const byTab = actions.filter((a) => inTab(a, today, tab))
    return applyActionFilters(byTab, { search, responsibleName, originType, status, siteId })
  }, [actions, today, tab, search, responsibleName, originType, status, siteId])

  // Regroupement par chantier (quand activé) : mêmes lignes filtrées, rangées par
  // chantier, en-tête + compte par groupe. Chantiers triés par nom.
  const groups = useMemo(() => {
    if (!groupBySite) return null
    const byId = new Map<string, { siteId: string; siteName: string; items: ActionDashboardItem[] }>()
    for (const a of rows) {
      const g = byId.get(a.siteId) ?? { siteId: a.siteId, siteName: a.siteName, items: [] }
      g.items.push(a)
      byId.set(a.siteId, g)
    }
    return [...byId.values()].sort((x, y) => x.siteName.localeCompare(y.siteName))
  }, [groupBySite, rows])

  const b = summary.proposalBreakdown

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-xl font-bold tracking-tight">Actions</h1>
        <p className="text-[13px] text-muted-foreground">Pilotage des engagements et obligations</p>
      </header>

      {/* ── 5 KPIs compacts, une seule ligne sur desktop (~15 % de l'écran) ── */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="À confirmer" value={summary.aConfirmer} accent="#d97706"
          sub={<>actions proposées<span className="mt-0.5 block text-[10.5px] text-muted-foreground/80">+{b.deadline} échéances · +{b.decision} décision · +{b.knowledge} conn. · +{b.stakeholder} interv.</span></>} />
        <Kpi label="Actions actives" value={summary.actives} accent="#2563eb"
          sub={<>{summary.activesBreakdown.open} ouvertes · {summary.activesBreakdown.planned} planifiée{summary.activesBreakdown.planned > 1 ? 's' : ''}</>} />
        <Kpi label="En retard" value={summary.enRetard} accent="#e11d48" sub="échéance dépassée" />
        <Kpi label="Sans preuve" value={summary.termineesSansPreuve} accent="#059669" sub="clôtures à justifier" />
        <Kpi label="Terminées" value={summary.terminees} accent="#0891b2" sub="historique conservé" />
      </section>

      {/* ── Onglets + filtres, COLLANTS pendant le scroll de la liste ── */}
      <div className="sticky top-0 z-20 -mx-6 border-b bg-background/95 px-6 pb-2.5 pt-2 backdrop-blur">
        <div className="mb-2 flex flex-wrap gap-4">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('flex items-center gap-1.5 border-b-2 pb-1.5 text-[13px] transition-colors',
                tab === t.key ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {t.label}
              <span className={cn('rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums', tab === t.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground/70')}>{tabCounts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-[13px]">
            <span className="text-muted-foreground">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une action, un chantier, un responsable…"
              className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
          </div>
          <select value={responsibleName ?? ''} onChange={(e) => setResponsible(e.target.value || null)} className="rounded-lg border bg-card px-2.5 py-1.5 text-[13px] text-muted-foreground">
            <option value="">Responsable</option>
            {filters.responsibles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={originType ?? ''} onChange={(e) => setOrigin((e.target.value || null) as ActionOrigin['type'] | null)} className="rounded-lg border bg-card px-2.5 py-1.5 text-[13px] text-muted-foreground">
            <option value="">Origine</option>
            {filters.origins.map((o) => <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>)}
          </select>
          <select value={status ?? ''} onChange={(e) => setStatus((e.target.value || null) as ActionListStatus | null)} className="rounded-lg border bg-card px-2.5 py-1.5 text-[13px] text-muted-foreground">
            <option value="">État</option>
            {filters.statuses.map((s) => <option key={s} value={s}>{ACTION_STATUS_LABEL[s]}</option>)}
          </select>
          {/* Lire les actions par chantier, sans perdre la vue globale. */}
          <select value={siteId ?? ''} onChange={(e) => setSiteId(e.target.value || null)} className="rounded-lg border bg-card px-2.5 py-1.5 text-[13px] text-muted-foreground">
            <option value="">Chantier</option>
            {filters.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {/* Regroupement activable (jamais imposé), dernier choix mémorisé. */}
          <button
            type="button"
            onClick={toggleGroupBySite}
            aria-pressed={groupBySite}
            className={cn('rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              groupBySite ? 'border-primary bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:text-foreground')}
          >
            Regrouper par chantier
          </button>
        </div>
      </div>

      {/* ── La liste : UNE LIGNE = UNE ACTION. Le titre domine (« quelle est la
           prochaine chose à faire ? »). Origine, échéance et responsable sont du
           CONTEXTE sous le titre — pas des colonnes qui se battent avec lui. ── */}
      <div className="overflow-hidden rounded-xl border bg-card">
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Aucune action ne correspond à ces filtres.</p>
        ) : groups ? (
          // Regroupé : un en-tête par chantier ; le 📍 par ligne devient redondant → masqué.
          <div className="divide-y divide-border/60">
            {groups.map((g) => (
              <div key={g.siteId}>
                <div className="flex items-center justify-between gap-2 bg-muted/30 px-4 py-2">
                  <span className="text-[12.5px] font-semibold text-foreground">📍 {g.siteName}</span>
                  <span className="text-[11.5px] font-medium tabular-nums text-muted-foreground">{g.items.length}</span>
                </div>
                <ul className="divide-y divide-border/60">
                  {g.items.map((a) => <ActionRow key={a.id} a={a} today={today} hideSite />)}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((a) => <ActionRow key={a.id} a={a} today={today} />)}
          </ul>
        )}
        <div className="border-t px-4 py-2.5 text-[12px] text-muted-foreground">{rows.length} action{rows.length > 1 ? 's' : ''}</div>
      </div>
    </div>
  )
}

// UNE LIGNE = UNE ACTION. Le titre domine (→ ouvre la fiche en surimpression).
// `hideSite` masque le 📍 chantier quand on est déjà regroupé par chantier.
function ActionRow({ a, today, hideSite = false }: { a: ActionDashboardItem; today: string; hideSite?: boolean }) {
  const overdue = isOverdue(a, today)
  const late = overdue && a.dueDate ? Math.abs(daysUntil(today, a.dueDate)) : 0
  return (
    <li className={cn('relative px-4 py-3 hover:bg-muted/40', overdue && 'bg-rose-50/40 dark:bg-rose-950/10')}>
      {overdue && <span className="absolute inset-y-0 left-0 w-[3px] bg-rose-500/70" />}
      {/* Le STATUT près du titre — il fait partie de l'identité de l'action. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', STATUS_CLS[a.status])}>{a.statusLabel}</span>
        {overdue && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
            ⚠ En retard de {late}&nbsp;jour{late > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {/* L'ENGAGEMENT — le titre est le héros (→ ouvre la fiche) */}
      <Link href={a.href} scroll={false} className="group mt-1 block">
        <p className="text-[15px] font-semibold leading-snug text-foreground group-hover:text-primary">{a.title}</p>
      </Link>
      {/* Le FAIT — visible mais SECONDAIRE, coloré, cliquable (→ visite/réunion/réserve) */}
      {a.origin && (
        <Link href={a.origin.href ?? '#'} className="mt-0.5 inline-flex items-center gap-1.5 text-[11.5px] hover:underline" style={{ color: ORIGIN_DOT[a.origin.type] }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
          {a.origin.label}
        </Link>
      )}
      {a.observed && <p className="mt-0.5 line-clamp-1 text-[11.5px] italic text-muted-foreground/80">« {a.observed} »</p>}
      {/* Le contexte, discret : où · qui · (échéance si pas déjà en retard).
          Le 📍 chantier (→ ouvre le chantier) est masqué en mode regroupé. */}
      <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted-foreground">
        {!hideSite && <Link href={`/sites/${a.siteId}`} className="hover:text-foreground hover:underline">📍 {a.siteName}</Link>}
        <span>👤 {a.responsibleName ?? 'À affecter'}</span>
        {!overdue && a.dueDate && (
          <span className={a.lateness.tone === 'neg' && a.status !== 'done' ? 'font-medium text-rose-600 dark:text-rose-400' : undefined}>
            📅 {frDue(a.dueDate)}{a.lateness.text && a.status !== 'done' && ` (${a.lateness.text})`}
          </span>
        )}
      </p>
    </li>
  )
}
