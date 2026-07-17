// /admin/usage — instrumentation LÉGÈRE pour le test terrain (2026-06-16).
//
// Répond aux 3 questions après une semaine d'usage réel :
//   1. Quels briefs sont ouverts ? (visite / réunion)
//   2. Que cherchent les gens ?    (top recherches mémoire)
//   3. Ouvrir un brief mène-t-il à une action ? (brief → action ≤ 10 min)
//
// ≠ audit sécurité (cf. /admin/activite). Données : table usage_events (migr. 113).
// Si la migration n'est pas appliquée, la synthèse renvoie des zéros (gracieux).

import { redirect } from 'next/navigation'
import { Eye, MessagesSquare, Search, ListTodo, Layers } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getUsageSummary, getScopeAttachStats } from '@/lib/db/usage-events'
import { getScopeMonitoring } from '@/lib/db/scope-suggestions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function AdminUsagePage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/missions')

  const [summary, scopeMon, attachStats] = await Promise.all([
    getUsageSummary(7),
    getScopeMonitoring(),
    getScopeAttachStats(7),
  ])
  const totalEvents = summary.visitOpens + summary.meetingOpens + summary.searches + summary.actionsCreated

  const counts = [
    { label: 'Brief visite', value: summary.visitOpens, icon: Eye, tone: 'text-sky-600 bg-sky-50' },
    { label: 'Brief réunion', value: summary.meetingOpens, icon: MessagesSquare, tone: 'text-violet-600 bg-violet-50' },
    { label: 'Recherches mémoire', value: summary.searches, icon: Search, tone: 'text-amber-600 bg-amber-50' },
    { label: 'Actions créées', value: summary.actionsCreated, icon: ListTodo, tone: 'text-emerald-600 bg-emerald-50' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usage (test terrain)</h1>
        <p className="text-sm text-muted-foreground">
          Ce qui est réellement ouvert, cherché et créé. Usage produit, pas audit de sécurité.
        </p>
      </div>

      {totalEvents === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
          <p className="font-medium">Aucune donnée d&apos;usage pour l&apos;instant.</p>
          <p className="mt-1 text-amber-900/80">
            L&apos;instrumentation est en place&nbsp;: les compteurs se rempliront dès que les briefs,
            recherches et actions seront utilisés. Si tout reste à&nbsp;0 après une utilisation réelle,
            vérifie que la <strong>migration 113</strong> (<code className="rounded bg-white/70 px-1">usage_events</code>)
            est bien appliquée.
          </p>
        </div>
      )}

      {/* Compteurs — 7 derniers jours */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counts.map((c) => {
          const Icon = c.icon
          return (
            <div key={c.label} className="rounded-xl border bg-card p-4">
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${c.tone}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</div>
              <div className="text-xs font-medium">{c.label}</div>
              <div className="text-[11px] text-muted-foreground">7 derniers jours</div>
            </div>
          )
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top recherches */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              Top recherches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary.topSearches.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Aucune recherche mémoire sur les 7 derniers jours.
              </p>
            ) : (
              <ul className="divide-y">
                {summary.topSearches.map((s) => (
                  <li key={s.query} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{s.query}</span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Brief → action */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-muted-foreground" />
              Brief → action
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-4xl font-semibold tabular-nums">{summary.briefToActionCount}</div>
            <p className="text-sm text-muted-foreground">
              Actions créées ≤ 10 min après l&apos;ouverture d&apos;un brief, par la même personne sur le
              même chantier. Indice que préparer une visite/réunion déclenche un acte concret.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rangement (scopes) — la mémoire se range-t-elle ? Observation admin
          SEULEMENT : le % n'est jamais montré à l'utilisateur (sur-rangement). */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" /> Rangement (scopes)
          </h2>
          <p className="text-sm text-muted-foreground">
            Le contenu terrain se range-t-il dans les sous-périmètres&nbsp;? Repère&nbsp;:
            &lt;10&nbsp;% = scopes décoratifs · &gt;80&nbsp;% = structure réelle de la mémoire.
          </p>
        </div>

        {scopeMon.overall.total === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Aucun chantier avec sous-périmètres pour l&apos;instant.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* KPI % rattaché + par site */}
            <Card>
              <CardHeader>
                <CardTitle className="inline-flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" /> % rattaché
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <span className="text-4xl font-semibold tabular-nums">{scopeMon.overall.pct}%</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {scopeMon.overall.attached}/{scopeMon.overall.total} contenus
                  </span>
                </div>
                <ul className="divide-y">
                  {scopeMon.sites.map((s) => (
                    <li key={s.siteId} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{s.name}</span>
                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                        {s.attached}/{s.total} · {s.pct}%
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  Couverture des suggestions&nbsp;: {scopeMon.coverage.withSuggestion}/{scopeMon.coverage.count} non rattachés ont une piste ({scopeMon.coverage.pct}%).
                </p>
              </CardContent>
            </Card>

            {/* Qualité des suggestions (Test B) */}
            <Card>
              <CardHeader>
                <CardTitle className="inline-flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-muted-foreground" /> Suggestions acceptées
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-4xl font-semibold tabular-nums">
                  {attachStats.acceptRatePct === null ? '—' : `${attachStats.acceptRatePct}%`}
                </div>
                <p className="text-sm text-muted-foreground">
                  Part des suggestions validées <strong>sans correction</strong> (qualité du moteur). 7 derniers jours.
                </p>
                <div className="flex flex-wrap gap-2 pt-1 text-xs">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                    {attachStats.accepted} acceptées
                  </span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                    {attachStats.overridden} corrigées
                  </span>
                  <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-muted-foreground">
                    {attachStats.manual} manuelles
                  </span>
                </div>
                {attachStats.total === 0 && (
                  <p className="text-[11px] text-muted-foreground/80 italic">
                    Aucun rattachement sur 7 jours — se remplit dès que « À rattacher » est utilisé.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </section>
    </div>
  )
}
