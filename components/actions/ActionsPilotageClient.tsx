'use client'

// V1-2 — vue « Actions à piloter » PARTAGÉE desktop + mobile. Hiérarchie SUJET → CBO → historique.
// Consomme le read-model getSiteActionsPilotage (aucune vérité locale, aucun recalcul) :
//   N1 = canonical subject (displayState P0-2), N2 = CBO durable (computedCurrentState C2A),
//   N3 = formulations documentaires brutes (site_actions), REPLIÉ, archive/preuves.
//
// P3-Actions-Lot1 — surface désormais TRANSACTIONNELLE : « Marquer comme traitée » / « Réouvrir »
// branchés sur les server actions EXISTANTES (closeActionAction/reopenActionAction → markSiteActionDone/
// reopenSiteAction → site_action_events → C2A native). Aucun nouveau lifecycle, aucune 2e vérité :
// le geste porte sur le membre déterministe `targetActionId` (le plus récent, prouvé §2) ; C2A décide
// l'état. La provenance (manuel vs documentaire) est LUE de computedCurrentState, jamais du status brut.

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, FileText, Check, RotateCcw, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { closeActionAction, reopenActionAction } from '@/app/(dashboard)/actions/actions'
import type { PilotageSubject, PilotageCbo } from '@/lib/knowledge/actions-pilotage'
import type { CanonicalDisplayState } from '@/lib/documents/subject-state'
import type { CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'

const SUBJECT_STATE: Record<CanonicalDisplayState, { label: string; color: string }> = {
  open:     { label: 'Ouvert',      color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  reopened: { label: 'Réouvert',    color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  resolved: { label: 'Résolu',      color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  unknown:  { label: 'Indéterminé', color: 'bg-muted text-muted-foreground' },
}

const CBO_STATE: Record<CboComputedCurrentState, { label: string; color: string }> = {
  open:                  { label: 'Ouvert',                  color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  progressing:           { label: 'En cours',                color: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  documentary_completed: { label: 'Terminé (documentaire)',  color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  documentary_reopened:  { label: 'Réouvert (documentaire)', color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  native_completed:      { label: 'Terminé',                 color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  native_reopened:       { label: 'Réouvert',                color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  native_cancelled:      { label: 'Annulé',                  color: 'bg-muted text-muted-foreground' },
  conforme_at:           { label: 'Conforme (ponctuel)',     color: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300' },
  unknown:               { label: 'À qualifier',             color: 'bg-muted text-muted-foreground' },
  conflict:              { label: 'Signaux contradictoires', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', color)}>{label}</span>
}

function frDate(d: string | null): string | null {
  if (!d) return null
  const t = Date.parse(d.length <= 10 ? `${d}T00:00:00` : d)
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : d.slice(0, 10)
}

/** Date métier de l'événement décisif, lue depuis stateBasis (`kind@YYYY-MM-DD`). */
function basisDate(stateBasis: string[]): string | null {
  const at = stateBasis[0]?.split('@')[1]
  return at ? frDate(at) : null
}

/** Provenance LUE de computedCurrentState (jamais du status brut). Distingue humain vs PV. */
function provenanceOf(c: PilotageCbo): string | null {
  const at = basisDate(c.stateBasis)
  switch (c.computedCurrentState) {
    case 'native_completed':      return `Marquée traitée manuellement${at ? ` le ${at}` : ''}`
    case 'native_reopened':       return `Rouverte manuellement${at ? ` le ${at}` : ''}`
    case 'native_cancelled':      return `Annulée manuellement${at ? ` le ${at}` : ''}`
    case 'documentary_completed': return `Terminée d'après un PV${at ? ` du ${at}` : ''}`
    case 'documentary_reopened':  return `Rouverte d'après un PV${at ? ` du ${at}` : ''}`
    case 'conforme_at':           return `Constatée conforme${at ? ` le ${at}` : ''}`
    default:                      return null
  }
}

function CboRow({ cbo, siteId }: { cbo: PilotageCbo; siteId: string }) {
  const cs = CBO_STATE[cbo.computedCurrentState]
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<null | 'treat' | 'reopen'>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canTreat = cbo.active && !!cbo.targetActionId
  const canReopen = cbo.computedCurrentState === 'native_completed' && !!cbo.targetActionId
  const hasDivergence = cbo.documentaryDivergences.length > 0
  const provenance = provenanceOf(cbo)

  function submitTreat() {
    if (!cbo.targetActionId || comment.trim().length === 0) return
    setError(null)
    const fd = new FormData()
    fd.set('id', cbo.targetActionId); fd.set('site_id', siteId); fd.set('comment', comment.trim())
    startTransition(async () => {
      const r = await closeActionAction(fd)
      if (!r.ok) { setError(r.error); return }
      setMode(null); setComment(''); router.refresh()
    })
  }
  function submitReopen() {
    if (!cbo.targetActionId) return
    setError(null)
    const fd = new FormData()
    fd.set('id', cbo.targetActionId); fd.set('site_id', siteId); fd.set('reason', comment.trim())
    startTransition(async () => {
      const r = await reopenActionAction(fd)
      if (!r.ok) { setError(r.error); return }
      setMode(null); setComment(''); router.refresh()
    })
  }

  return (
    <li className="rounded-lg border px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 leading-snug">{cbo.label}</span>
        <Badge label={cs.label} color={cs.color} />
        {cbo.conflicts.length > 0 && <Badge label="conflit" color="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" />}
        {canTreat && mode === null && (
          <button type="button" onClick={() => { setMode('treat'); setError(null) }}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 dark:hover:bg-emerald-950/40">
            <Check className="h-3 w-3" /> Marquer comme traitée
          </button>
        )}
        {canReopen && mode === null && (
          <button type="button" onClick={() => { setMode('reopen'); setError(null) }}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium hover:bg-orange-50 hover:text-orange-700 hover:border-orange-200 dark:hover:bg-orange-950/40">
            <RotateCcw className="h-3 w-3" /> Réouvrir
          </button>
        )}
      </div>

      {/* Provenance (lue de C2A) */}
      {provenance && mode === null && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{provenance}</p>
      )}

      {/* Divergence documentaire après clôture humaine — factuel + CTA réouvrir */}
      {hasDivergence && mode === null && (
        <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" /> Un PV ultérieur indique que ce point pourrait être à nouveau ouvert.
        </p>
      )}

      {/* Confirmation « Marquer comme traitée » — commentaire requis (provenance) */}
      {mode === 'treat' && (
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2">
          <p className="text-[11px] font-medium">Marquer cette obligation comme traitée ?</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} disabled={pending}
            placeholder="Qu'avez-vous fait ? (obligatoire)" rows={2} maxLength={1000}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring" />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitTreat} disabled={pending || comment.trim().length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer
            </button>
            <button type="button" onClick={() => { setMode(null); setComment(''); setError(null) }} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}

      {/* Confirmation « Réouvrir » — motif facultatif */}
      {mode === 'reopen' && (
        <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2">
          <p className="text-[11px] font-medium">Réouvrir cette obligation ?</p>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} disabled={pending}
            placeholder="Motif (facultatif)" rows={2} maxLength={1000}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring" />
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitReopen} disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-orange-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer la réouverture
            </button>
            <button type="button" onClick={() => { setMode(null); setComment(''); setError(null) }} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}
    </li>
  )
}

export function ActionsPilotageClient({ subjects, siteId }: { subjects: PilotageSubject[]; siteId: string }) {
  if (subjects.length === 0) {
    return (
      <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        Aucun sujet à piloter sur ce chantier.
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {subjects.map((s) => {
        const st = SUBJECT_STATE[s.displayState]
        return (
          <li key={s.canonicalSubjectId} className="rounded-xl border text-sm">
            <details className="group/subj">
              {/* N1 — SUJET */}
              <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 select-none hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium leading-snug">{s.label}</span>
                    <Badge label={st.label} color={st.color} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{s.activeCboCount} objet{s.activeCboCount > 1 ? 's' : ''} actif{s.activeCboCount > 1 ? 's' : ''} / {s.totalCboCount}</span>
                    {s.pvCount > 0 && <span>· {s.pvCount} PV</span>}
                    {s.lastMeaningfulChangeAt && <span>· dernière évolution {frDate(s.lastMeaningfulChangeAt)}</span>}
                  </div>
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/subj:rotate-90" />
              </summary>

              <div className="border-t px-3 py-2.5 space-y-3">
                {/* N2 — CBO durables (transactionnels) */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Objets métier à piloter</p>
                  <ul className="space-y-1.5">
                    {s.cbos.map((c) => <CboRow key={c.cboId} cbo={c} siteId={siteId} />)}
                  </ul>
                  <Link href={`/sites/${siteId}/historique/sujets/${s.canonicalSubjectId}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    Voir la fiche du sujet <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>

                {/* N3 — historique documentaire (replié, archive/preuves) */}
                {s.formulations.length > 0 && (
                  <details className="group/hist rounded-lg bg-muted/30">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground select-none">
                      <FileText className="h-3.5 w-3.5" />
                      Historique documentaire — {s.formulations.length} formulation{s.formulations.length > 1 ? 's' : ''}
                      {s.formulationPvCount > 0 && ` dans ${s.formulationPvCount} PV`}
                      <ChevronRight className="h-3 w-3 transition-transform group-open/hist:rotate-90" />
                    </summary>
                    <ul className="border-t px-3 py-2 space-y-1">
                      {s.formulations.map((f) => (
                        <li key={f.id} className="text-xs text-muted-foreground">
                          <span className="text-foreground">{f.title}</span>
                          {f.dueDate && <span> · échéance {frDate(f.dueDate)}</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="px-3 pb-2 text-[11px] text-muted-foreground/70">Formulations telles que détectées dans les PV (preuves documentaires), regroupées par ce sujet.</p>
                  </details>
                )}
              </div>
            </details>
          </li>
        )
      })}
    </ul>
  )
}
