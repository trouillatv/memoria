'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Network, Check, X } from 'lucide-react'
import type { SubjectThreadLink, SubjectLinkType } from '@/lib/db/subject-thread-links'
import { confirmLinkAction, rejectLinkAction } from './link-validation-actions'

const LINK_TYPE_LABELS: Record<SubjectLinkType, { label: string; description: string }> = {
  requires:   { label: 'nécessite',     description: "Ce sujet requiert l'autre au préalable" },
  enables:    { label: 'permet',        description: "Ce sujet rend l'autre possible" },
  causes:     { label: 'entraîne',      description: "Ce sujet provoque ou déclenche l'autre" },
  validates:  { label: 'valide',        description: "Ce sujet valide ou qualifie l'autre" },
  replaces:   { label: 'remplace',      description: "Ce sujet rend l'autre obsolète" },
  relates_to: { label: 'est associé à', description: 'Lien thématique sans causalité directe' },
}

type OptimisticStatus = 'confirmed' | 'rejected'

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    cooccurrence: 'Co-occurrence',
    extraction:   'Extraction',
    human:        'Manuel',
  }
  return (
    <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">
      {map[source] ?? source}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null
  const pct = Math.round(confidence * 100)
  const color =
    pct >= 90 ? 'text-emerald-700 dark:text-emerald-400'
    : pct >= 70 ? 'text-amber-700 dark:text-amber-400'
    : 'text-muted-foreground'
  return <span className={`text-xs font-semibold tabular-nums ${color}`}>{pct}%</span>
}

function LinkCard({
  link,
  siteId,
  optimisticStatus,
  onConfirm,
  onReject,
  isPending,
}: {
  link: SubjectThreadLink
  siteId: string
  optimisticStatus: OptimisticStatus | null
  onConfirm: () => void
  onReject: () => void
  isPending: boolean
}) {
  const status = optimisticStatus ?? 'suggested'
  const typeLabel = LINK_TYPE_LABELS[link.linkType]?.label ?? link.linkType

  return (
    <div className={`rounded-lg border p-3 space-y-2 text-sm transition-colors ${
      status === 'confirmed'
        ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20'
        : status === 'rejected'
          ? 'border-muted/60 bg-muted/20 opacity-60'
          : 'bg-card'
    }`}>
      {/* Relation */}
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          {link.fromCanonicalSubjectId ? (
            <Link
              href={`/sites/${siteId}/historique/sujets/${link.fromCanonicalSubjectId}`}
              className="font-medium text-sm hover:underline truncate max-w-[40%]"
            >
              {link.fromLabel ?? link.fromThreadId}
            </Link>
          ) : (
            <span className="font-medium text-sm truncate max-w-[40%]">{link.fromLabel ?? link.fromThreadId}</span>
          )}
          <span className="text-xs text-muted-foreground italic shrink-0">{typeLabel}</span>
          {link.toCanonicalSubjectId ? (
            <Link
              href={`/sites/${siteId}/historique/sujets/${link.toCanonicalSubjectId}`}
              className="font-medium text-sm hover:underline truncate max-w-[40%]"
            >
              {link.toLabel ?? link.toThreadId}
            </Link>
          ) : (
            <span className="font-medium text-sm truncate max-w-[40%]">{link.toLabel ?? link.toThreadId}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SourceBadge source={link.source} />
          <ConfidenceBadge confidence={link.confidence} />
        </div>
      </div>

      {/* Justification */}
      {link.justification && (
        <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{link.justification}</p>
      )}

      {/* Actions */}
      {status === 'suggested' && (
        <div className="pt-1 border-t flex items-center gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60 disabled:opacity-50 transition-colors"
          >
            <Check className="h-3 w-3" />
            {isPending ? '…' : 'Confirmer'}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <X className="h-3 w-3" />
            Rejeter
          </button>
        </div>
      )}

      {status === 'confirmed' && (
        <p className="pt-1 border-t text-xs text-emerald-700 dark:text-emerald-400">Lien confirmé</p>
      )}

      {status === 'rejected' && (
        <p className="pt-1 border-t text-xs text-muted-foreground">Lien rejeté</p>
      )}
    </div>
  )
}

export function SiteLinkValidationSection({
  initialLinks,
  siteId,
}: {
  initialLinks: SubjectThreadLink[]
  siteId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [optimistic, setOptimistic] = useState<Map<string, OptimisticStatus>>(new Map())

  if (initialLinks.length === 0) return null

  function getStatus(l: SubjectThreadLink): OptimisticStatus | null {
    return optimistic.get(l.id) ?? null
  }

  const stillPending = initialLinks.filter((l) => !optimistic.has(l.id))
  const acted = initialLinks.filter((l) => optimistic.has(l.id))

  function act(
    linkId: string,
    optimisticValue: OptimisticStatus,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setError(null)
    setOptimistic((prev) => new Map(prev).set(linkId, optimisticValue))
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        router.refresh()
      } else {
        setOptimistic((prev) => {
          const next = new Map(prev)
          next.delete(linkId)
          return next
        })
        setError(result.error ?? 'Erreur')
      }
    })
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/30 dark:border-violet-900/40 dark:bg-violet-950/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Network className="h-4 w-4 text-violet-700 dark:text-violet-400 shrink-0" />
        <h2 className="text-sm font-semibold">
          Relations à valider
          {stillPending.length > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-900/50 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
              {stillPending.length}
            </span>
          )}
        </h2>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {stillPending.length === 0 && acted.length > 0 ? (
        <p className="text-sm text-muted-foreground italic text-center py-2">
          Aucune relation à valider
        </p>
      ) : (
        <div className="space-y-2">
          {stillPending.map((l) => (
            <LinkCard
              key={l.id}
              link={l}
              siteId={siteId}
              optimisticStatus={getStatus(l)}
              isPending={isPending}
              onConfirm={() => act(l.id, 'confirmed', () => confirmLinkAction(l.id, siteId))}
              onReject={() => act(l.id, 'rejected', () => rejectLinkAction(l.id, siteId))}
            />
          ))}
        </div>
      )}

      {acted.length > 0 && (
        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-1">
            <span className="group-open:hidden">▶</span>
            <span className="hidden group-open:inline">▼</span>
            {acted.length} décision{acted.length > 1 ? 's' : ''} enregistrée{acted.length > 1 ? 's' : ''}
          </summary>
          <div className="mt-2 space-y-2">
            {acted.map((l) => (
              <LinkCard
                key={l.id}
                link={l}
                siteId={siteId}
                optimisticStatus={getStatus(l)}
                isPending={isPending}
                onConfirm={() => act(l.id, 'confirmed', () => confirmLinkAction(l.id, siteId))}
                onReject={() => act(l.id, 'rejected', () => rejectLinkAction(l.id, siteId))}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
