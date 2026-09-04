'use client'

// V1-2 — vue « Actions à piloter » PARTAGÉE desktop + mobile. Hiérarchie SUJET → CBO → historique.
// Consomme UNIQUEMENT le read-model getSiteActionsPilotage (aucune vérité locale, aucun recalcul) :
//   N1 = canonical subject (displayState P0-2), N2 = CBO durable (computedCurrentState C2A),
//   N3 = formulations documentaires brutes (site_actions), REPLIÉ, présenté comme archive/preuves.
// Le brut N3 n'est jamais une vérité d'état ni une charge opérationnelle courante.

import Link from 'next/link'
import { ChevronRight, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PilotageSubject } from '@/lib/knowledge/actions-pilotage'
import type { CanonicalDisplayState } from '@/lib/documents/subject-state'
import type { CboComputedCurrentState } from '@/lib/knowledge/cbo-lifecycle-reducer'

const SUBJECT_STATE: Record<CanonicalDisplayState, { label: string; color: string }> = {
  open:     { label: 'Ouvert',      color: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  reopened: { label: 'Réouvert',    color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  resolved: { label: 'Résolu',      color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  unknown:  { label: 'Indéterminé', color: 'bg-muted text-muted-foreground' },
}

// Mêmes libellés/couleurs que la fiche sujet (E1) ; unknown affiché « À qualifier » (jamais ouvert).
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
                {/* N2 — CBO durables */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Objets métier à piloter</p>
                  <ul className="space-y-1.5">
                    {s.cbos.map((c) => {
                      const cs = CBO_STATE[c.computedCurrentState]
                      return (
                        <li key={c.cboId} className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5">
                          <span className="min-w-0 flex-1 leading-snug">{c.label}</span>
                          <Badge label={cs.label} color={cs.color} />
                          {c.conflicts.length > 0 && <Badge label="conflit" color="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" />}
                          {c.documentaryDivergences.length > 0 && <Badge label="divergence documentaire" color="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" />}
                        </li>
                      )
                    })}
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
