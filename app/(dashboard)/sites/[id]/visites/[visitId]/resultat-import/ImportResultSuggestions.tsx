'use client'

// Cartes de rapprochement inline — résultat d'import (P1-A, lot UI symétrique 2026-08-20).
//
// Score/verdict/reason/sens viennent tels quels du moteur (canonical_subject_
// similarity_suggestion) : jamais recalculés ni inventés ici. Chaque côté
// affiche soit ce que dit réellement CE PV (extrait exact + page), soit
// l'extrait déjà connu en mémoire (canonical_subject_occurrence) — jamais
// les deux mélangés, jamais de texte de remplissage. Le jeu de boutons
// dépend strictement de la recommandation du moteur :
//   merge  → CAS B (fusion)      : "Fusionner les sujets" / "Garder séparés"
//   link   → CAS A (relation)    : "Confirmer la relation" / "Ils ne sont pas liés"
//   none   → CAS C (incertain)   : affichage honnête, aucun forçage
// (Vincent, 2026-08-20)

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MemoryBuildSuggestion, MemoryBuildSuggestionSide } from '@/lib/db/memory-build-result'
import {
  acceptSuggestionAsMergeAction,
  acceptSuggestionAsLinkAction,
  rejectSuggestionAction,
} from '../../../historique/similarity-actions'

function scoreStyle(score: number) {
  if (score >= 90) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' }
  if (score >= 75) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40' }
  return { text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40' }
}

const VERDICT_LABEL: Record<string, string> = {
  same_subject: 'probablement le même sujet',
  related: 'sujets liés probablement',
  distinct: 'sujets distincts',
  uncertain: 'rapprochement incertain',
}

// Dupliqué depuis lib/db/subject-thread-links.ts (LINK_TYPE_LABELS) : ce fichier
// importe lib/supabase/admin (server-only), impossible à charger dans un client component.
const LINK_TYPE_LABEL: Record<string, string> = {
  requires: 'nécessite',
  enables: 'permet',
  causes: 'entraîne',
  validates: 'valide',
  replaces: 'remplace',
  relates_to: 'est associé à',
}

const frDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

function relationDisplay(s: MemoryBuildSuggestion): { label: string; arrow: string } {
  if (s.recommendation === 'merge') return { label: 'Fusion possible', arrow: '↔' }
  if (s.recommendation === 'link' && s.suggestedLinkType) {
    return { label: LINK_TYPE_LABEL[s.suggestedLinkType] ?? s.suggestedLinkType, arrow: s.suggestedDirection === 'b_to_a' ? '←' : '→' }
  }
  return { label: VERDICT_LABEL[s.verdict] ?? s.verdict, arrow: '?' }
}

function SideCard({ side, bothTouched }: { side: MemoryBuildSuggestionSide; bothTouched: boolean }) {
  const badge = bothTouched
    ? 'PRÉSENT DANS CE PV'
    : side.touchedByThisPv
      ? 'NOUVEAU DANS CE PV'
      : 'DÉJÀ CONNU DANS LA MÉMOIRE'
  const badgeStyle = side.touchedByThisPv
    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  const excerpt = side.touchedByThisPv ? side.pvExcerpt : side.knownExcerpt

  return (
    <div className="min-w-0 flex-1 rounded-lg border bg-card p-3">
      <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold tracking-wide ${badgeStyle}`}>
        {badge}
      </span>
      <p className="mt-1.5 text-[13.5px] font-medium">{side.label}</p>
      {excerpt && (
        <p className="mt-1 text-[12.5px] italic text-muted-foreground">« {excerpt} »</p>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted-foreground">
        {side.touchedByThisPv && side.pvExcerptPage != null && <span>page {side.pvExcerptPage}</span>}
        {!side.touchedByThisPv && side.knownSince && <span>connu depuis le {frDate(side.knownSince)}</span>}
        {!side.touchedByThisPv && side.knownEvidenceCount != null && (
          <span>{side.knownEvidenceCount} élément{side.knownEvidenceCount > 1 ? 's' : ''} en mémoire</span>
        )}
      </div>
    </div>
  )
}

export function ImportResultSuggestions({
  siteId,
  initialSuggestions,
}: {
  siteId: string
  initialSuggestions: MemoryBuildSuggestion[]
}) {
  const router = useRouter()
  const [suggestions, setSuggestions] = useState(initialSuggestions)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [errorState, setErrorState] = useState<{ id: string; message: string } | null>(null)

  const resolve = (id: string) => {
    setSuggestions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      // Bascule vers l'état "terminé" (compteurs + CTA) rendu par la page serveur.
      if (next.length === 0) router.refresh()
      return next
    })
    setPendingId(null)
  }

  const handleMerge = async (s: MemoryBuildSuggestion) => {
    setPendingId(s.id)
    setErrorState(null)
    const result = await acceptSuggestionAsMergeAction(
      s.id,
      s.sideA.canonicalSubjectId,
      s.sideB.canonicalSubjectId,
      s.suggestedLabel ?? s.sideA.label,
      siteId,
    )
    if (result.error) { setErrorState({ id: s.id, message: result.error }); setPendingId(null) }
    else resolve(s.id)
  }

  const handleLink = async (s: MemoryBuildSuggestion) => {
    setPendingId(s.id)
    setErrorState(null)
    const [from, to] = s.suggestedDirection === 'b_to_a'
      ? [s.sideB.canonicalSubjectId, s.sideA.canonicalSubjectId]
      : [s.sideA.canonicalSubjectId, s.sideB.canonicalSubjectId]
    const result = await acceptSuggestionAsLinkAction(s.id, from, to, s.suggestedLinkType ?? 'relates_to', siteId, s.reason)
    if (result.error) { setErrorState({ id: s.id, message: result.error }); setPendingId(null) }
    else resolve(s.id)
  }

  const handleReject = async (s: MemoryBuildSuggestion) => {
    setPendingId(s.id)
    setErrorState(null)
    const result = await rejectSuggestionAction(s.id, siteId)
    if (result.error) { setErrorState({ id: s.id, message: result.error }); setPendingId(null) }
    else resolve(s.id)
  }

  if (suggestions.length === 0) {
    return <p className="text-[13px] text-muted-foreground">Tous les rapprochements proposés pour ce PV ont été traités.</p>
  }

  return (
    <div className="space-y-3">
      {suggestions.map((s) => {
        const { text, bg } = scoreStyle(s.score)
        const busy = pendingId === s.id
        const { label: relationLabel, arrow } = relationDisplay(s)
        return (
          <div key={s.id} className="rounded-xl border p-4">
            {s.bothTouchedByThisPv && (
              <p className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
                Deux sujets concernés par ce PV
              </p>
            )}

            <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
              <SideCard side={s.sideA} bothTouched={s.bothTouchedByThisPv} />

              <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-1 py-2 text-center md:w-[150px]">
                <span aria-hidden className="text-lg text-muted-foreground">{arrow}</span>
                <span className="text-[12.5px] font-medium">{relationLabel}</span>
                <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${bg} ${text}`}>
                  Confiance IA {s.score}%
                </span>
              </div>

              <SideCard side={s.sideB} bothTouched={s.bothTouchedByThisPv} />
            </div>

            {s.reason && (
              <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground">
                {s.reason}
              </p>
            )}
            {errorState?.id === s.id && <p className="mt-1.5 text-[13px] text-destructive">{errorState.message}</p>}

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {s.recommendation === 'merge' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleMerge(s)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {busy ? 'Fusion…' : 'Fusionner les sujets'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleReject(s)}
                    className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-muted disabled:opacity-40"
                  >
                    Garder séparés
                  </button>
                </>
              )}
              {s.recommendation === 'link' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleLink(s)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    {busy ? 'Liaison…' : 'Confirmer la relation'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleReject(s)}
                    className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-muted disabled:opacity-40"
                  >
                    Ils ne sont pas liés
                  </button>
                </>
              )}
              {s.recommendation === 'none' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleMerge(s)}
                    className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-muted disabled:opacity-40"
                  >
                    Même sujet
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleLink(s)}
                    className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-muted disabled:opacity-40"
                  >
                    Liés
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleReject(s)}
                    className="rounded-lg border px-3 py-1.5 text-[12.5px] hover:bg-muted disabled:opacity-40"
                  >
                    Distincts
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
