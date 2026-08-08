'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GitMerge } from 'lucide-react'
import type { SiteSubjectSuggestionRow } from '@/lib/db/subject-suggestions'
import {
  acceptSuggestionAction,
  rejectSuggestionAction,
  undoSuggestionAction,
} from '@/lib/documents/suggestion-actions'

function frDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null
  const pct = Math.round(confidence * 100)
  const color =
    pct >= 90 ? 'text-emerald-700 dark:text-emerald-400'
    : pct >= 70 ? 'text-amber-700 dark:text-amber-400'
    : 'text-muted-foreground'
  return <span className={`text-xs font-medium tabular-nums ${color}`}>{pct} %</span>
}

function SuggestionCard({
  suggestion,
  onAccept,
  onReject,
  onUndo,
  isPending,
  siteId,
}: {
  suggestion: SiteSubjectSuggestionRow & { optimisticResolution?: string }
  onAccept: () => void
  onReject: () => void
  onUndo: () => void
  isPending: boolean
  siteId: string
}) {
  const resolution = suggestion.optimisticResolution ?? suggestion.resolution

  return (
    <div className={`rounded-lg border p-3 space-y-2 text-sm transition-colors ${
      resolution === 'accepted'
        ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'
        : resolution === 'rejected'
          ? 'border-muted/60 bg-muted/20 opacity-60'
          : 'bg-card'
    }`}>
      {/* Origine */}
      {(suggestion.origin_label || suggestion.origin_date) && (
        <p className="text-[11px] text-muted-foreground/80">
          {suggestion.origin_label
            ? <span className="font-medium">{suggestion.origin_label}</span>
            : null}
          {suggestion.origin_label && suggestion.origin_date ? ' · ' : null}
          {suggestion.origin_date ? frDate(suggestion.origin_date) : null}
        </p>
      )}

      {/* Label source → candidat */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
          Rapprochement suggéré
        </p>
        <p className="font-medium leading-snug text-sm">
          {suggestion.proposal_label}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">→</span>
          {suggestion.candidate_canonical_subject_id ? (
            <Link
              href={`/sites/${siteId}/historique/sujets/${suggestion.candidate_canonical_subject_id}`}
              className="font-medium text-foreground hover:underline"
            >
              {suggestion.candidate_label ?? suggestion.candidate_canonical_subject_id}
            </Link>
          ) : (
            <span className="font-medium text-foreground">
              {suggestion.candidate_label ?? '—'}
            </span>
          )}
        </div>
      </div>

      {/* Confiance + raisonnement */}
      <div className="flex items-start gap-2">
        <ConfidenceBadge confidence={suggestion.model_confidence} />
        {suggestion.reasoning && (
          <p className="text-xs text-muted-foreground leading-snug line-clamp-2 flex-1">
            {suggestion.reasoning}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="pt-1 border-t flex items-center gap-2 flex-wrap">
        {resolution === 'pending' && (
          <>
            <button
              type="button"
              onClick={onAccept}
              disabled={isPending}
              className="rounded-md px-3 py-1.5 text-xs font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60 disabled:opacity-50 transition-colors"
            >
              {isPending ? '…' : 'Associer'}
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={isPending}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              Garder séparé
            </button>
          </>
        )}

        {resolution === 'accepted' && (
          <div className="flex items-center gap-2 flex-wrap w-full">
            <span className="text-xs text-emerald-700 dark:text-emerald-400">
              Associé{suggestion.resolved_at ? ` · ${frDate(suggestion.resolved_at)}` : ''}
            </span>
            <button
              type="button"
              onClick={onUndo}
              disabled={isPending}
              className="ml-auto rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {isPending ? '…' : 'Annuler la décision'}
            </button>
          </div>
        )}

        {resolution === 'rejected' && (
          <div className="flex items-center gap-2 flex-wrap w-full">
            <span className="text-xs text-muted-foreground">
              Gardé séparé{suggestion.resolved_at ? ` · ${frDate(suggestion.resolved_at)}` : ''}
            </span>
            <button
              type="button"
              onClick={onUndo}
              disabled={isPending}
              className="ml-auto rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {isPending ? '…' : 'Annuler la décision'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function SiteSubjectSuggestionsSection({
  initialSuggestions,
  siteId,
}: {
  initialSuggestions: SiteSubjectSuggestionRow[]
  siteId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<Map<string, string>>(new Map())

  if (initialSuggestions.length === 0) return null

  function getResolution(s: SiteSubjectSuggestionRow): string {
    return optimistic.get(s.id) ?? s.resolution
  }

  const stillPending = initialSuggestions.filter((s) => getResolution(s) === 'pending')
  const acted = initialSuggestions.filter((s) => getResolution(s) !== 'pending')

  function act(
    suggestionId: string,
    optimisticValue: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setError(null)
    setOptimistic((prev) => new Map(prev).set(suggestionId, optimisticValue))
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        router.refresh()
      } else {
        setOptimistic((prev) => {
          const next = new Map(prev)
          next.delete(suggestionId)
          return next
        })
        setError(result.error ?? 'Erreur')
      }
    })
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <GitMerge className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
        <h2 className="text-sm font-semibold">
          Sujets à rapprocher
          {stillPending.length > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
              {stillPending.length}
            </span>
          )}
        </h2>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {stillPending.length === 0 && acted.length > 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-2">
          Aucun rapprochement à examiner
        </p>
      ) : (
        <div className="space-y-2">
          {stillPending.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={{ ...s, optimisticResolution: optimistic.get(s.id) }}
              isPending={isPending}
              siteId={siteId}
              onAccept={() => act(s.id, 'accepted', () => acceptSuggestionAction(s.id))}
              onReject={() => act(s.id, 'rejected', () => rejectSuggestionAction(s.id))}
              onUndo={() => act(s.id, 'pending', () => undoSuggestionAction(s.id))}
            />
          ))}
        </div>
      )}

      {/* Décisions optimistes en attente de refresh */}
      {acted.length > 0 && (
        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-1">
            <span className="group-open:hidden">▶</span>
            <span className="hidden group-open:inline">▼</span>
            {acted.length} décision{acted.length > 1 ? 's' : ''} enregistrée{acted.length > 1 ? 's' : ''}
          </summary>
          <div className="mt-2 space-y-2">
            {acted.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={{ ...s, optimisticResolution: optimistic.get(s.id) }}
                isPending={isPending}
                siteId={siteId}
                onAccept={() => act(s.id, 'accepted', () => acceptSuggestionAction(s.id))}
                onReject={() => act(s.id, 'rejected', () => rejectSuggestionAction(s.id))}
                onUndo={() => act(s.id, 'pending', () => undoSuggestionAction(s.id))}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
