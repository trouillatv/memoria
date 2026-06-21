// « Préparer cette réunion » — surface des DÉTECTEURS déterministes (mémoire chantier).
// Ce qui traîne sur le site AVANT la réunion : actions en retard, décisions jamais
// appliquées, entreprises absentes, réserves ouvertes. Affichage seul (server
// component), calme et DESCRIPTIF — pas d'alerte rouge. Chaque bloc explicite sa source.
import Link from 'next/link'
import { ListTodo, Gavel, Building2, ClipboardCheck, Sparkles, Repeat, HelpCircle, Flame, Layers, ArrowRight } from 'lucide-react'
import type { MemorySignal, SignalKind, SuggestedQuestion } from '@/lib/db/site-memory-signals'
import type { SubjectWatch } from '@/lib/db/subjects'

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  bloqué: { label: 'Bloqué', cls: 'bg-rose-100 text-rose-700' },
  en_attente: { label: 'En attente', cls: 'bg-amber-100 text-amber-800' },
  dormant: { label: 'En sommeil', cls: 'bg-slate-100 text-slate-600' },
  ouvert: { label: 'Ouvert', cls: 'bg-sky-100 text-sky-700' },
  clos: { label: 'Clos', cls: 'bg-emerald-100 text-emerald-700' },
}

function SubjectsToWatch({ subjects, siteId }: { subjects: SubjectWatch[]; siteId: string }) {
  if (subjects.length === 0) return null
  return (
    <section>
      <h3 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Layers className="h-3.5 w-3.5" /> Sujets à surveiller ({subjects.length})
      </h3>
      <ul className="mt-1.5 space-y-1.5">
        {subjects.map((s) => {
          const b = STATE_BADGE[s.state] ?? STATE_BADGE.ouvert
          return (
            <li key={s.id} className="rounded-lg border bg-background/40 p-2.5 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span>
                <Link href={`/sites/${siteId}/subjects/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                {s.ageDays != null && <span className="text-[11px] text-muted-foreground">{s.ageDays} j · énergie {s.energy}</span>}
                <Link href={`/sites/${siteId}/subjects/${s.id}`} className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground">détail <ArrowRight className="h-3 w-3" /></Link>
              </div>
              <div className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
                {s.cause && <span className="block">{s.cause}</span>}
                {s.lastEvolution && <span className="block">Dernière évolution : {s.lastEvolution}</span>}
                {s.openQuestion && <span className="block italic">Question : {s.openQuestion}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const META: Record<SignalKind, { icon: typeof ListTodo; tone: string }> = {
  actor_congestion: { icon: Flame, tone: 'text-orange-700' },
  recurring_topic: { icon: Repeat, tone: 'text-rose-700' },
  action_overdue: { icon: ListTodo, tone: 'text-amber-700' },
  decision_unapplied: { icon: Gavel, tone: 'text-violet-700' },
  actor_absent: { icon: Building2, tone: 'text-sky-700' },
  reserve_open: { icon: ClipboardCheck, tone: 'text-emerald-700' },
}

export function PrepareMeetingBlock({ signals, questions = [], subjects = [], siteId }: { signals: MemorySignal[]; questions?: SuggestedQuestion[]; subjects?: SubjectWatch[]; siteId?: string }) {
  if (signals.length === 0 && subjects.length === 0) {
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

      {/* SUJETS À SURVEILLER — l'intelligence du sujet remonte AVANT la réunion : pas
          seulement « quoi surveiller » mais « pourquoi c'est encore ouvert ». */}
      {siteId && <SubjectsToWatch subjects={subjects} siteId={siteId} />}

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
                      {/* Contexte / Historique déterministe (P3) : l'histoire de l'élément. */}
                      {it.context && it.context.length > 0 && (
                        <span className="mt-0.5 block border-l-2 border-muted pl-2 text-[11px] text-muted-foreground">
                          {it.context.map((c, i) => <span key={i} className="block">{c}</span>)}
                        </span>
                      )}
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
          <ul className="mt-1.5 space-y-1">
            {questions.map((qz, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
                <span className="min-w-0">
                  {qz.question}
                  {qz.why && <span className="block text-[11px] text-muted-foreground">Pourquoi : {qz.why}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
