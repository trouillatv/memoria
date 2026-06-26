'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Check, AlertTriangle, MessageCircleQuestion, ChevronDown, Lightbulb } from 'lucide-react'
import { toast } from 'sonner'
import { analyzeVisitDebriefAction, validateVisitDebriefAction, type DebriefAnalysis } from '../actions'

type Outcome = '' | 'ras' | 'conforme' | 'conforme_reserves' | 'non_conforme' | 'a_revoir' | 'info'
type Resolution = '' | 'resolue' | 'a_suivre' | 'recontrole'

const OUTCOMES: Array<{ v: Outcome; l: string }> = [
  { v: '', l: '—' },
  { v: 'ras', l: 'RAS' },
  { v: 'conforme', l: 'Conforme' },
  { v: 'conforme_reserves', l: 'Conforme avec réserves' },
  { v: 'non_conforme', l: 'Non conforme' },
  { v: 'a_revoir', l: 'À revoir' },
  { v: 'info', l: 'Information uniquement' },
]
const RESOLUTIONS: Array<{ v: Resolution; l: string }> = [
  { v: '', l: '—' },
  { v: 'resolue', l: 'Résolue' },
  { v: 'a_suivre', l: 'À suivre' },
  { v: 'recontrole', l: 'Recontrôle nécessaire' },
]

export function VisitDebriefPanel({
  siteId,
  reportId,
  openSubjects,
  initial,
}: {
  siteId: string
  reportId: string
  openSubjects: Array<{ id: string; name: string }>
  initial: { objective: string; outcome: string | null; resolution: string | null; targetSubjectId: string | null }
}) {
  const router = useRouter()
  const [analyzing, startAnalyze] = useTransition()
  const [saving, startSave] = useTransition()
  const [analysis, setAnalysis] = useState<DebriefAnalysis | null>(null)

  const [objective, setObjective] = useState(initial.objective)
  const [subjectId, setSubjectId] = useState(initial.targetSubjectId ?? '')
  const [outcome, setOutcome] = useState<Outcome>((initial.outcome as Outcome) ?? '')
  const [resolution, setResolution] = useState<Resolution>((initial.resolution as Resolution) ?? '')
  const [acceptedActions, setAcceptedActions] = useState<Set<string>>(new Set())
  const [proposedSubjectName, setProposedSubjectName] = useState<string | null>(null)

  function analyze() {
    startAnalyze(async () => {
      const res = await analyzeVisitDebriefAction(reportId)
      if (!res.ok) { toast.error(res.error); return }
      const p = res.analysis.proposal
      setAnalysis(res.analysis)
      if (p.objective) setObjective(p.objective)
      if (p.outcome) setOutcome(p.outcome as Outcome)
      if (p.resolution) setResolution(p.resolution as Resolution)
      if (p.subject_match_index >= 0 && res.analysis.openSubjects[p.subject_match_index]) {
        setSubjectId(res.analysis.openSubjects[p.subject_match_index].id)
        setProposedSubjectName(null)
      } else if (p.subject_name) {
        setProposedSubjectName(p.subject_name)
      }
      setAcceptedActions(new Set())
      toast.success(`Lecture proposée (${res.analysis.provider})`, { duration: 2000 })
    })
  }

  function toggleAction(title: string) {
    setAcceptedActions((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  function save() {
    startSave(async () => {
      const res = await validateVisitDebriefAction({
        site_id: siteId,
        report_id: reportId,
        objective: objective.trim() || undefined,
        target_subject_id: subjectId || undefined,
        outcome: outcome || undefined,
        resolution: resolution || undefined,
        accepted_actions: Array.from(acceptedActions),
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success(res.createdActions > 0 ? `Débrief enregistré · ${res.createdActions} action(s) créée(s)` : 'Débrief enregistré')
      router.refresh()
    })
  }

  const p = analysis?.proposal
  const hasDetail = !!p && (p.important_points.length > 0 || p.suggested_actions.length > 0 || p.forgotten_obligations.length > 0 || p.open_questions.length > 0)

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Débrief</h2>
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-800 disabled:opacity-50 dark:bg-violet-950/30 dark:text-violet-200"
        >
          <Sparkles className="h-4 w-4" />
          {analyzing ? 'Lecture en cours…' : analysis ? 'Relire' : 'Analyser'}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        MemorIA lit les captures et propose une lecture. Rien n’est enregistré tant que vous n’avez pas validé.
      </p>

      {/* Agent 1 — le raisonnement narratif, avant toute structure. */}
      {analysis?.narrative && (
        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ce que MemorIA a compris</div>
          <p className="whitespace-pre-line text-sm leading-relaxed">{analysis.narrative}</p>
        </div>
      )}

      {/* NIVEAU 1 — ce qui mérite ton attention (3 à 5 max). Toujours visible. */}
      {p && p.attention.length > 0 && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 dark:bg-amber-950/20">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" /> Ce qui mérite ton attention
          </div>
          <ul className="space-y-1 text-sm">
            {p.attention.slice(0, 5).map((x, i) => <li key={i}>• {x}</li>)}
          </ul>
        </div>
      )}

      {/* NIVEAU 2 — la lecture proposée (dépliable, ouverte par défaut). */}
      <details open className="group rounded-xl border">
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
          Lecture proposée
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-3 border-t p-3">
          <Field label="Objectif">
            <input
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="ex. contrôler les enrobés"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <RowMeta confidence={p?.objective_confidence ?? null} why={p?.objective_rationale} />
          </Field>

          <Field label="Sujet">
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
              <option value="">—</option>
              {openSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {proposedSubjectName && !subjectId && (
              <p className="mt-1 text-xs text-violet-700 dark:text-violet-300">
                Sujet proposé : « {proposedSubjectName} » (nouveau — non rattaché tant qu’il n’existe pas)
              </p>
            )}
            <RowMeta confidence={p?.subject_confidence ?? null} why={p?.subject_rationale} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Résultat">
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
                {OUTCOMES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </Field>
            <Field label="Résolution">
              <select value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
                {RESOLUTIONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </details>

      {/* NIVEAU 3 — tout le détail (dépliable, fermé par défaut). */}
      {hasDetail && p && (
        <details className="group rounded-xl border">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
            Tout le détail
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t p-3">
            {p.important_points.length > 0 && (
              <Block icon={<Lightbulb className="h-4 w-4 text-amber-600" />} title="Points relevés">
                <ul className="space-y-1 text-sm">{p.important_points.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </Block>
            )}

            {p.suggested_actions.length > 0 && (
              <Block icon={<Check className="h-4 w-4 text-emerald-600" />} title="Actions proposées — cochez celles à créer">
                <ul className="space-y-2 text-sm">
                  {p.suggested_actions.map((a, i) => (
                    <li key={i}>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={acceptedActions.has(a.title)} onChange={() => toggleAction(a.title)} className="mt-1" />
                        <span>
                          {a.title}
                          {a.rationale && <span className="mt-0.5 block text-xs text-muted-foreground"><span className="font-medium">Pourquoi ?</span> {a.rationale}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {p.forgotten_obligations.length > 0 && (
              <Block icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} title="Probablement oublié">
                <ul className="space-y-1 text-sm">{p.forgotten_obligations.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </Block>
            )}

            {p.open_questions.length > 0 && (
              <Block icon={<MessageCircleQuestion className="h-4 w-4 text-sky-600" />} title="Questions ouvertes">
                <ul className="space-y-1 text-sm">{p.open_questions.map((x, i) => <li key={i}>• {x}</li>)}</ul>
              </Block>
            )}
          </div>
        </details>
      )}

      <div className="flex justify-end border-t pt-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          <Check className="h-4 w-4" /> {saving ? 'Enregistrement…' : 'Valider le débrief'}
        </button>
      </div>
    </section>
  )
}

const CONF_META: Record<string, { l: string; cls: string }> = {
  elevee: { l: 'Élevée', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' },
  moyenne: { l: 'Moyenne', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300' },
  faible: { l: 'Faible', cls: 'bg-muted text-muted-foreground' },
}

function RowMeta({ confidence, why }: { confidence: string | null; why?: string }) {
  if (!confidence && !why) return null
  const c = confidence ? CONF_META[confidence] : null
  return (
    <div className="mt-1 space-y-0.5">
      {c && <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}>Confiance : {c.l}</span>}
      {why && <p className="text-xs text-muted-foreground"><span className="font-medium">Pourquoi ?</span> {why}</p>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Block({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{icon}{title}</div>
      {children}
    </div>
  )
}
