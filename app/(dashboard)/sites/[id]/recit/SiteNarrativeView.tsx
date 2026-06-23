// Récit du chantier — rendu pur (server component). Lecture « humaine » :
// une synthèse déterministe en tête, puis l'histoire mois par mois.
import type { SiteNarrative } from '@/lib/db/site-narrative'

function frDate(civil: string): string {
  const [y, m, d] = civil.split('-').map(Number)
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function StorySummary({ summary }: { summary: SiteNarrative['summary'] }) {
  const s = summary
  if (!s.startedOn) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pas encore d&apos;histoire à raconter — aucun jalon (réunion, blocage, livraison, réserve…) sur ce chantier.
      </p>
    )
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="leading-relaxed">
        Le chantier a démarré le <strong>{frDate(s.startedOn)}</strong>
        {s.durationDays !== null ? <> — ouvert depuis <strong>{s.durationDays} j</strong></> : null}. Il est
        actuellement en phase <strong>{s.phase}</strong>.
        {s.topSubject ? <> Le sujet le plus actif a été <strong>{s.topSubject}</strong>.</> : null}
      </p>

      {s.blocages.total > 0 && (
        <div>
          <p>
            <strong>{s.blocages.total}</strong> blocage{s.blocages.total > 1 ? 's' : ''} rencontré
            {s.blocages.total > 1 ? 's' : ''} — <strong>{s.blocages.totalDays} j</strong> cumulés&nbsp;:
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {s.blocages.byType.map((b) => (
              <li key={b.type}>
                {b.pct}% {b.label.toLowerCase()} ({b.days} j{b.count > 1 ? `, ${b.count} épisodes` : ''})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
        <span>{s.reunions} réunion{s.reunions > 1 ? 's' : ''}</span>
        {s.decisions > 0 && <span>{s.decisions} décision{s.decisions > 1 ? 's' : ''}</span>}
        {(s.reserves.open + s.reserves.lifted) > 0 && (
          <span>
            {s.reserves.lifted}/{s.reserves.open + s.reserves.lifted} réserve
            {s.reserves.open + s.reserves.lifted > 1 ? 's' : ''} levée{s.reserves.lifted > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}

export function SiteNarrativeView({ narrative }: { narrative: SiteNarrative }) {
  const { months, summary } = narrative

  return (
    <div className="space-y-8">
      <section className="rounded-xl border bg-card p-4 space-y-2">
        <h2 className="text-sm font-semibold">Raconte-moi ce chantier</h2>
        <StorySummary summary={summary} />
        <p className="text-[11px] text-muted-foreground/70 pt-1">
          Synthèse déterministe — comptée à partir des jalons, jamais une prédiction.
        </p>
      </section>

      {months.length === 0 ? null : (
        <div className="space-y-8">
          {months.map((month) => (
            <section key={month.monthKey} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {month.monthLabel}
              </h3>
              <ol className="relative space-y-4 border-l border-border/60 pl-5">
                {month.events.map((e, i) => (
                  <li key={`${e.kind}-${e.at}-${i}`} className="relative">
                    <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-background text-[13px] leading-none">
                      {e.icon}
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{frDate(e.date)}</span>
                      <span className="text-sm font-medium">{e.title}</span>
                    </div>
                    {e.detail && <p className="mt-0.5 text-xs text-muted-foreground">{e.detail}</p>}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
