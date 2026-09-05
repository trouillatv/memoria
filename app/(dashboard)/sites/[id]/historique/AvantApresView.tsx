import Link from 'next/link'
import { ArrowLeftRight, ChevronRight, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SiteWindowComparison, WindowBoundState, WindowChangeCategory, WindowSubjectDelta } from '@/lib/documents/pv-window-comparison'
import { WindowBoundsSelector } from './WindowBoundsSelector'

// AVANT / APRÈS — « montre-moi uniquement ce qui a réellement changé entre ces deux moments ».
// Rendu fidèle à la maquette produit : bandeau explicatif, deux sélecteurs de bornes, ligne de
// KPI par catégorie, tableau avant → après à badges, puis sections repliées. AUCUNE donnée
// ajoutée : chaque valeur affichée vient de `pv-window-comparison`. Pas de colonne « commentaire »
// tant qu'aucune source déterministe ne l'alimente. Zéro jargon interne dans le rendu.

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── États aux bornes (badges) ────────────────────────────────────────────────
const STATE_LABEL: Record<WindowBoundState, string> = {
  absent: 'pas encore suivi',
  unknown: 'état non précisé',
  open: 'ouvert',
  resolved: 'résolu',
}
const STATE_BADGE: Record<WindowBoundState, string> = {
  absent: 'bg-muted text-muted-foreground',
  unknown: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  open: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
}

function StateBadge({ state }: { state: WindowBoundState }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', STATE_BADGE[state])}>
      {STATE_LABEL[state]}
    </span>
  )
}

// ── Catégories (KPI + badge Évolution) ───────────────────────────────────────
interface CategoryMeta {
  key: WindowChangeCategory
  title: string
  hint: string
  kpi: string // fond de la carte KPI
  kpiNum: string // couleur du nombre
  badge: string // badge « Évolution » dans le tableau
  bar: string // segment plein dans la barre de répartition
  dot: string // pastille de légende
}

/** Registres OUVERTS : vrais changements métier entre les deux bornes. */
const VISIBLE_CATEGORIES: CategoryMeta[] = [
  { key: 'réouvert', title: 'Réouverts', hint: 'résolus à la première date, de nouveau ouverts à la seconde', kpi: 'bg-rose-50 dark:bg-rose-950/40', kpiNum: 'text-rose-600 dark:text-rose-400', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  { key: 'résolu', title: 'Résolus', hint: 'ouverts à la première date, résolus à la seconde', kpi: 'bg-emerald-50 dark:bg-emerald-950/40', kpiNum: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'apparu', title: 'Apparus', hint: 'absents de tout l’historique avant la première date', kpi: 'bg-blue-50 dark:bg-blue-950/40', kpiNum: 'text-blue-600 dark:text-blue-400', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300', bar: 'bg-blue-500', dot: 'bg-blue-500' },
  { key: 'réapparu', title: 'Réapparus', hint: 'connus auparavant, absents à la première date, de retour à la seconde', kpi: 'bg-violet-50 dark:bg-violet-950/40', kpiNum: 'text-violet-600 dark:text-violet-400', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300', bar: 'bg-violet-500', dot: 'bg-violet-500' },
]

/** Registres REPLIÉS : ni changement métier, ni interprétables tels quels. */
const FOLDED_CATEGORIES: CategoryMeta[] = [
  { key: 'plus_mentionné', title: 'Plus mentionnés', hint: 'absents du compte rendu d’arrivée — leur dernier état connu est conservé, ce n’est pas une résolution', kpi: 'bg-muted', kpiNum: 'text-foreground', badge: 'bg-muted text-muted-foreground', bar: 'bg-zinc-400', dot: 'bg-zinc-400' },
  { key: 'état_précisé', title: 'État précisé', hint: 'leur état n’était pas établi à la première date, il l’est à la seconde — ce n’est pas un changement de situation', kpi: 'bg-slate-50 dark:bg-slate-900/60', kpiNum: 'text-slate-600 dark:text-slate-300', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', bar: 'bg-slate-400', dot: 'bg-slate-400' },
  { key: 'inchangé', title: 'Inchangés', hint: 'même état aux deux dates', kpi: 'bg-muted/60', kpiNum: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground', bar: 'bg-zinc-200 dark:bg-zinc-700', dot: 'bg-zinc-300 dark:bg-zinc-600' },
]

const ALL_CATEGORIES: CategoryMeta[] = [...VISIBLE_CATEGORIES, ...FOLDED_CATEGORIES]
const metaOf = (k: WindowChangeCategory) => ALL_CATEGORIES.find((c) => c.key === k)!

/**
 * Synthèse métier — 100 % dérivée de `counts`, aucune donnée ajoutée. La phrase est
 * l'élément PRINCIPAL de la vue. Format compact à points médians :
 *   « N changements réels sur M sujets suivis »
 *   « 3 réouverts · 1 résolu · 12 apparus · 2 réapparus · 31 plus mentionnés »
 * `inchangé` et `état_précisé` ne sont pas listés ici (baseline / précision, pas un changement) —
 * ils restent visibles dans les KPI et la barre.
 */
function buildSynthesis(data: SiteWindowComparison): { headline: string; tokens: Array<{ key: WindowChangeCategory; text: string }> } {
  const c = data.counts
  const net = c.réouvert + c.résolu + c.apparu + c.réapparu
  const total = data.rows.length
  const headline = `${net} changement${net > 1 ? 's' : ''} réel${net > 1 ? 's' : ''} sur ${total} sujets suivis`

  const label = (n: number, sing: string, plur: string) => `${n} ${n > 1 ? plur : sing}`
  const tokens: Array<{ key: WindowChangeCategory; text: string }> = []
  if (c.réouvert) tokens.push({ key: 'réouvert', text: label(c.réouvert, 'réouvert', 'réouverts') })
  if (c.résolu) tokens.push({ key: 'résolu', text: label(c.résolu, 'résolu', 'résolus') })
  if (c.apparu) tokens.push({ key: 'apparu', text: label(c.apparu, 'apparu', 'apparus') })
  if (c.réapparu) tokens.push({ key: 'réapparu', text: label(c.réapparu, 'réapparu', 'réapparus') })
  if (c.plus_mentionné) tokens.push({ key: 'plus_mentionné', text: label(c.plus_mentionné, 'plus mentionné', 'plus mentionnés') })

  return { headline, tokens }
}

function EvolutionBadge({ category }: { category: WindowChangeCategory }) {
  const m = metaOf(category)
  const label = m.title.replace(/s$/, '') // « Réouverts » → « Réouvert »
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', m.badge)}>{label}</span>
}

// ── Tableau avant → après ────────────────────────────────────────────────────
function ComparisonTable({ rows, data, withEvolution }: { rows: WindowSubjectDelta[]; data: SiteWindowComparison; withEvolution: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-foreground/70">
            <th className="rounded-l-lg py-3 pl-3 pr-4">Sujet</th>
            <th className="px-4 py-3">État au {fmtShort(data.from.effectiveDate)}</th>
            <th className="px-4 py-3">État au {fmtShort(data.to.effectiveDate)}</th>
            {withEvolution && <th className="px-4 py-3">Évolution</th>}
            <th className="px-4 py-3 text-center">Constats</th>
            <th className="rounded-r-lg py-3 pl-4 pr-3 text-right">Fiche</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((it) => (
            <tr key={it.canonicalSubjectId} className="group transition hover:bg-muted/40">
              <td className="max-w-[280px] py-4 pl-3 pr-4">
                <span className="block truncate font-semibold">{it.label}</span>
              </td>
              <td className="px-4 py-4"><StateBadge state={it.beforeState} /></td>
              <td className="px-4 py-4"><StateBadge state={it.afterState} /></td>
              {withEvolution && <td className="px-4 py-4"><EvolutionBadge category={it.category} /></td>}
              <td className="px-4 py-4 text-center text-xs text-muted-foreground">
                {it.stateEventCount > 1 ? it.stateEventCount : '—'}
              </td>
              <td className="py-4 pl-4 pr-3 text-right">
                <Link
                  href={`/sites/${data.siteId}/historique/sujets/${it.canonicalSubjectId}`}
                  className="inline-flex items-center gap-0.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                >
                  Voir <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AvantApresView({ siteId, data }: { siteId: string; data: SiteWindowComparison }) {
  const byCat = (k: WindowChangeCategory) => data.rows.filter((r) => r.category === k)
  const netRows = VISIBLE_CATEGORIES.flatMap((c) => byCat(c.key)).sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  const netChanges = netRows.length
  const lastRun = data.runs[data.runs.length - 1]
  const total = data.rows.length
  const { headline, tokens } = buildSynthesis(data)

  return (
    <div className="space-y-4">
      {/* ── En-tête du bloc ─────────────────────────────────────────────── */}
      <section className="rounded-[22px] border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <ArrowLeftRight className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Avant / Après</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Comparer l’état des sujets entre deux PV pour voir ce qui a réellement changé.
              </p>
            </div>
          </div>
          <details className="group shrink-0">
            <summary className="cursor-pointer list-none text-xs font-medium text-primary underline-offset-2 hover:underline">
              Comment ça marche ?
            </summary>
            <p className="mt-2 max-w-xs text-right text-xs text-muted-foreground">
              On lit l’état prouvé de chaque sujet à la première puis à la seconde date. Seul le
              résultat net compte : les allers-retours entre les deux dates ne créent pas de ligne.
            </p>
          </details>
        </div>

        {/* Bandeau explicatif */}
        <div className="mt-4 flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Cette vue montre la <strong>situation nette</strong> entre deux PV choisis. Seuls les
            changements d’état réels sont indiqués, d’après l’état prouvé aux deux dates. Les sujets
            simplement re-mentionnés sans changement sont regroupés et repliés par défaut.
          </p>
        </div>

        {/* Sélecteurs de bornes */}
        <div className="mt-5">
          <WindowBoundsSelector
            siteId={siteId}
            runs={data.runs.map((r) => ({ runId: r.id, effectiveDate: r.effectiveDate, pvNumber: r.pvNumber }))}
            fromRunId={data.from.runId}
            toRunId={data.to.runId}
          />
        </div>

        {/* Ligne de contexte réduite (dates portées par la synthèse ci-dessous) */}
        <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          {data.rows.length} sujets suivis (hors acteurs) · dernier PV du chantier : {fmt(lastRun.effectiveDate)}
        </div>
      </section>

      {/* ── Synthèse métier : phrase dynamique (élément principal) + barre ── */}
      <section className="rounded-[22px] border border-primary/20 bg-primary/5 p-5 shadow-sm">
        <p className="text-2xl font-bold tracking-tight text-primary">{headline}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">du {fmt(data.from.effectiveDate)} au {fmt(data.to.effectiveDate)}</p>
        {tokens.length > 0 && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            {tokens.map((t, i) => (
              <span key={t.key} className="inline-flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground/50" aria-hidden>·</span>}
                <span>
                  <span className={cn('font-semibold', metaOf(t.key).kpiNum)}>{t.text.split(' ')[0]}</span>{' '}
                  <span className="text-muted-foreground">{t.text.split(' ').slice(1).join(' ')}</span>
                </span>
              </span>
            ))}
          </p>
        )}

        <div className="mt-4">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Répartition des {total} sujets</div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {ALL_CATEGORIES.map((c) => {
              const pct = total ? (data.counts[c.key] / total) * 100 : 0
              if (pct === 0) return null
              return <div key={c.key} className={c.bar} style={{ width: `${pct}%` }} title={`${c.title} : ${data.counts[c.key]}`} />
            })}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {ALL_CATEGORIES.filter((c) => data.counts[c.key] > 0).map((c) => (
              <li key={c.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', c.dot)} aria-hidden />
                {c.title} <span className="font-medium text-foreground">{data.counts[c.key]}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Ligne de KPI par catégorie ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {ALL_CATEGORIES.map((c) => (
          <div key={c.key} className={cn('rounded-2xl border p-4 shadow-sm', c.kpi)}>
            <div className={cn('text-2xl font-bold tabular-nums', c.kpiNum)}>{data.counts[c.key]}</div>
            <div className="mt-0.5 text-xs font-medium text-muted-foreground">{c.title}</div>
          </div>
        ))}
      </div>

      {/* ── Section principale : changements d'état ─────────────────────── */}
      <section className="rounded-[22px] border bg-card p-6 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">
              Changements d’état <span className="text-muted-foreground">({netChanges} sujet{netChanges > 1 ? 's' : ''})</span>
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Sujets dont l’état a réellement changé entre les deux dates.
            </p>
          </div>
        </div>

        <div className="mt-4">
          {netChanges === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center">
              <p className="font-medium">Aucun changement de situation</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sur cette période, aucun sujet n’a changé d’état de façon nette. Les re-mentions et
                précisions d’état sont regroupées ci-dessous.
              </p>
            </div>
          ) : (
            <ComparisonTable rows={netRows} data={data} withEvolution />
          )}
        </div>
      </section>

      {/* ── Sections repliées ───────────────────────────────────────────── */}
      <div className="space-y-3">
        {FOLDED_CATEGORIES.map((c) => {
          const items = byCat(c.key)
          return (
            <details key={c.key} className="group rounded-[18px] border bg-card shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-90" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">
                    {c.title} <span className="text-muted-foreground">({items.length})</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{c.hint}</div>
                </div>
              </summary>
              {items.length > 0 && (
                <div className="border-t px-5 py-4">
                  <ComparisonTable rows={items} data={data} withEvolution={false} />
                </div>
              )}
            </details>
          )
        })}
      </div>
    </div>
  )
}
