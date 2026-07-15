'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ChevronDown, Lightbulb, MessageCircleQuestion, Pencil, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { analyzeVisitDebriefAction, validateVisitDebriefAction, type DebriefAnalysis } from '../actions'

type Outcome = '' | 'ras' | 'conforme' | 'conforme_reserves' | 'non_conforme' | 'a_revoir' | 'info'
type Resolution = '' | 'resolue' | 'a_suivre' | 'recontrole'

const OUTCOMES: Array<{ v: Outcome; l: string }> = [
  { v: '', l: '-' },
  { v: 'ras', l: 'RAS' },
  { v: 'conforme', l: 'Conforme' },
  { v: 'conforme_reserves', l: 'Conforme avec reserves' },
  { v: 'non_conforme', l: 'Non conforme' },
  { v: 'a_revoir', l: 'A revoir' },
  { v: 'info', l: 'Information uniquement' },
]

const RESOLUTIONS: Array<{ v: Resolution; l: string }> = [
  { v: '', l: '-' },
  { v: 'resolue', l: 'Resolue' },
  { v: 'a_suivre', l: 'A suivre' },
  { v: 'recontrole', l: 'Recontrole necessaire' },
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
  const [editing, setEditing] = useState(false)

  const [objective, setObjective] = useState(initial.objective)
  const [subjectId, setSubjectId] = useState(initial.targetSubjectId ?? '')
  const [outcome, setOutcome] = useState<Outcome>((initial.outcome as Outcome) ?? '')
  const [resolution, setResolution] = useState<Resolution>((initial.resolution as Resolution) ?? '')
  const [acceptedActions, setAcceptedActions] = useState<Set<string>>(new Set())
  const [proposedSubjectName, setProposedSubjectName] = useState<string | null>(null)

  function analyze() {
    startAnalyze(async () => {
      const res = await analyzeVisitDebriefAction(reportId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      const proposal = res.analysis.proposal
      setAnalysis(res.analysis)
      if (proposal.objective) setObjective(proposal.objective)
      if (proposal.outcome) setOutcome(proposal.outcome as Outcome)
      if (proposal.resolution) setResolution(proposal.resolution as Resolution)
      if (proposal.subject_match_index >= 0 && res.analysis.openSubjects[proposal.subject_match_index]) {
        setSubjectId(res.analysis.openSubjects[proposal.subject_match_index].id)
        setProposedSubjectName(null)
      } else if (proposal.subject_name) {
        setProposedSubjectName(proposal.subject_name)
      }
      setAcceptedActions(new Set())
      setEditing(false)
      toast.success(`Premiere version prete (${res.analysis.provider})`, { duration: 2000 })
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
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(res.createdActions > 0 ? `Debrief enregistre - ${res.createdActions} action(s) creee(s)` : 'Debrief enregistre')
      router.refresh()
    })
  }

  const proposal = analysis?.proposal
  const hasDetail = !!proposal && (
    proposal.important_points.length > 0 ||
    proposal.suggested_actions.length > 0 ||
    proposal.forgotten_obligations.length > 0 ||
    proposal.open_questions.length > 0
  )

  return (
    <section className="space-y-4 rounded-2xl border border-emerald-200 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Premiere version du compte rendu</h2>
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 disabled:opacity-50 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          <Sparkles className="h-4 w-4" />
          {analyzing ? 'Preparation...' : analysis ? 'Recreer une version' : 'Creer une premiere version'}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        MemorIA prepare automatiquement ce qui peut l etre. Rien n est enregistre tant que vous n avez pas valide.
      </p>

      {!analysis && (
        <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center">
          <p className="text-sm font-medium">La premiere version apparaitra ici.</p>
          <p className="mt-1 text-sm text-muted-foreground">Creez-la, relisez-la, puis modifiez uniquement ce qui doit l etre.</p>
          <button
            type="button"
            onClick={analyze}
            disabled={analyzing}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {analyzing ? 'Preparation...' : 'Creer une premiere version'}
          </button>
        </div>
      )}

      {analysis && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100">
          <p className="font-medium">MemorIA a prepare une premiere version.</p>
          <p className="mt-0.5 text-emerald-900/80 dark:text-emerald-100/80">
            Prenez 30 secondes pour la relire. Corrigez uniquement ce qui doit l etre.
          </p>
        </div>
      )}

      {proposal && proposal.attention.length > 0 && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 dark:bg-amber-950/20">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" /> Points a relire
          </div>
          <ul className="space-y-1 text-sm">
            {proposal.attention.slice(0, 5).map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}

      {analysis?.narrative && (
        <div className="rounded-xl border bg-background p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ce que MemorIA a compris</div>
          <p className="whitespace-pre-line text-sm leading-relaxed">{analysis.narrative}</p>
        </div>
      )}

      {analysis && (
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <Pencil className="h-4 w-4" />
          {editing ? 'Fermer les modifications' : 'Modifier cette version'}
        </button>
      )}

      {analysis && editing && (
        <details open className="group rounded-xl border">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
            Champs de validation
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-3 border-t p-3">
            <Field label="Objectif">
              <input
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder="ex. controler les enrobes"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
              <RowMeta confidence={proposal?.objective_confidence ?? null} why={proposal?.objective_rationale} />
            </Field>

            <Field label="Point concerne">
              <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
                <option value="">-</option>
                {openSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
              {proposedSubjectName && !subjectId && (
                <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-2 text-xs text-violet-900 dark:bg-violet-950/20 dark:text-violet-100">
                  <p className="font-medium">MemorIA pense que cette visite concerne :</p>
                  <p className="mt-0.5">{proposedSubjectName}</p>
                </div>
              )}
              <RowMeta confidence={proposal?.subject_confidence ?? null} why={proposal?.subject_rationale} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Resultat">
                <select value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
                  {OUTCOMES.map((item) => <option key={item.v} value={item.v}>{item.l}</option>)}
                </select>
              </Field>
              <Field label="Suite a donner">
                <select value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)} className="w-full rounded-lg border bg-background px-3 py-2 text-sm">
                  {RESOLUTIONS.map((item) => <option key={item.v} value={item.v}>{item.l}</option>)}
                </select>
              </Field>
            </div>
          </div>
        </details>
      )}

      {analysis && editing && hasDetail && proposal && (
        <details className="group rounded-xl border">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
            Ce que MemorIA suggere
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t p-3">
            {proposal.important_points.length > 0 && (
              <Block icon={<Lightbulb className="h-4 w-4 text-amber-600" />} title="Points releves">
                <ul className="space-y-1 text-sm">{proposal.important_points.map((item, index) => <li key={index}>{item.label}</li>)}</ul>
              </Block>
            )}
            {proposal.suggested_actions.length > 0 && (
              <Block icon={<Check className="h-4 w-4 text-emerald-600" />} title="Actions a creer">
                <ul className="space-y-2 text-sm">
                  {proposal.suggested_actions.map((action, index) => (
                    <li key={index}>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={acceptedActions.has(action.title)} onChange={() => toggleAction(action.title)} className="mt-1" />
                        <span>
                          {action.title}
                          {action.rationale && <span className="mt-0.5 block text-xs text-muted-foreground">{action.rationale}</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </Block>
            )}
            {proposal.forgotten_obligations.length > 0 && (
              <Block icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} title="Probablement oublie">
                <ul className="space-y-1 text-sm">{proposal.forgotten_obligations.map((item, index) => <li key={index}>{item}</li>)}</ul>
              </Block>
            )}
            {proposal.open_questions.length > 0 && (
              <Block icon={<MessageCircleQuestion className="h-4 w-4 text-sky-600" />} title="Questions ouvertes">
                <ul className="space-y-1 text-sm">{proposal.open_questions.map((item, index) => <li key={index}>{item}</li>)}</ul>
              </Block>
            )}
          </div>
        </details>
      )}

      {analysis && (
        <div className="flex justify-end border-t pt-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> {saving ? 'Enregistrement...' : 'Valider le compte rendu'}
          </button>
        </div>
      )}
    </section>
  )
}

const CONF_META: Record<string, { label: string; className: string }> = {
  elevee: { label: 'Reconnu avec confiance', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' },
  moyenne: { label: 'Tres probable', className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300' },
  faible: { label: 'A verifier', className: 'bg-muted text-muted-foreground' },
}

function RowMeta({ confidence, why }: { confidence: string | null; why?: string }) {
  if (!confidence && !why) return null
  const meta = confidence ? CONF_META[confidence] : null
  return (
    <div className="mt-1 space-y-0.5">
      {meta && <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>}
      {why && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Pourquoi ?</summary>
          <p className="mt-1">{why}</p>
        </details>
      )}
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
