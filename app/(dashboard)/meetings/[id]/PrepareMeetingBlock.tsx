// « Préparer cette réunion » — surface des DÉTECTEURS déterministes (mémoire chantier).
// Ce qui traîne sur le site AVANT la réunion : actions en retard, décisions jamais
// appliquées, entreprises absentes, réserves ouvertes. Affichage seul (server
// component), calme et DESCRIPTIF — pas d'alerte rouge. Chaque bloc explicite sa source.
import { ListTodo, Gavel, Building2, ClipboardCheck, Sparkles, Repeat, HelpCircle } from 'lucide-react'
import type { MemorySignal, SignalKind } from '@/lib/db/site-memory-signals'

const META: Record<SignalKind, { icon: typeof ListTodo; tone: string }> = {
  recurring_topic: { icon: Repeat, tone: 'text-rose-700' },
  action_overdue: { icon: ListTodo, tone: 'text-amber-700' },
  decision_unapplied: { icon: Gavel, tone: 'text-violet-700' },
  actor_absent: { icon: Building2, tone: 'text-sky-700' },
  reserve_open: { icon: ClipboardCheck, tone: 'text-emerald-700' },
}

export function PrepareMeetingBlock({ signals, questions = [] }: { signals: MemorySignal[]; questions?: string[] }) {
  if (signals.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-muted-foreground" /> Préparer cette réunion
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Rien ne traîne sur ce chantier — aucune action en retard, décision non appliquée, absence répétée ni réserve ouverte.</p>
      </section>
    )
  }
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-muted-foreground" /> Préparer cette réunion
        </h2>
        <span className="text-xs text-muted-foreground">Avant de commencer, ce qui reste à traiter sur le chantier</span>
      </div>
      <ul className="space-y-2">
        {signals.map((s) => {
          const m = META[s.kind]
          const Icon = m.icon
          return (
            <li key={s.kind} className="rounded-lg border bg-background/40 p-3">
              <div className={`inline-flex items-center gap-1.5 text-sm font-medium ${m.tone}`}>
                <Icon className="h-4 w-4" /> {s.title}
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {s.items.map((it) => (
                  <li key={it.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
                    <span className="min-w-0">
                      {it.label}
                      {it.meta && <span className="text-muted-foreground"> — {it.meta}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] italic text-muted-foreground/70">{s.source}</p>
            </li>
          )
        })}
      </ul>

      {/* Questions à poser — déterministe (signal → question), pas de LLM créatif. */}
      {questions.length > 0 && (
        <div className="rounded-lg border border-dashed bg-background/40 p-3">
          <div className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
            <HelpCircle className="h-4 w-4 text-muted-foreground" /> Questions à poser
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {questions.map((qz, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
                <span className="min-w-0">{qz}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
