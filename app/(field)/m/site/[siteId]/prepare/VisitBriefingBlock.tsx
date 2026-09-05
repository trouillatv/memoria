import Link from 'next/link'
import type { VisitBriefing } from '@/lib/knowledge/visit-briefing'

/** Candidat de visite sérialisé pour le client (sous-ensemble de ObjectVisitCandidate). */
export interface VisitCandidateView {
  sourceKind: string
  sourceRef: string
  label: string
  reason: string | null
  verificationMode: 'field_check' | 'ask_confirm'
}

/** Un geste de visite. PAS d'urgence : la pastille est neutre, le mode dit le geste
 *  (constater / demander), jamais une priorité. reason = contexte, quand disponible. */
function CandidateRow({ item }: { item: VisitCandidateView }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-muted-foreground/40" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-snug text-foreground">
          {item.label}
        </span>
        {item.reason && (
          <span className="block text-[12px] leading-snug text-muted-foreground">
            {item.reason}
          </span>
        )}
      </span>
    </div>
  )
}

function DeltaRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="text-[13px] font-medium text-foreground">
      <span className={`font-bold ${color}`}>{value}</span> {label}
    </span>
  )
}

export function VisitBriefingBlock({
  briefing,
  siteId,
  fieldCheck,
  askConfirm,
}: {
  briefing: VisitBriefing
  siteId: string
  /** WOW-2D — population MACHINE object-first, identique à ce qui sera seedé. */
  fieldCheck: VisitCandidateView[]
  askConfirm: VisitCandidateView[]
}) {
  const { delta, watchlistOpenCount } = briefing

  const hasFieldCheck = fieldCheck.length > 0
  const hasAskConfirm = askConfirm.length > 0
  const hasDelta = delta !== null
  const hasWatchlist = watchlistOpenCount > 0

  if (!hasFieldCheck && !hasAskConfirm && !hasDelta && !hasWatchlist) return null

  const sinceLabel = delta
    ? new Date(delta.since).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
    : null

  return (
    <div className="space-y-5">
      {/* ── WOW-2D — À constater sur place (field_check) ────────────────────── */}
      {hasFieldCheck && (
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            À constater sur place
          </h2>
          <div className="divide-y divide-foreground/[0.06] rounded-2xl border border-foreground/[0.06] bg-card px-4">
            {fieldCheck.map((item) => (
              <CandidateRow key={`${item.sourceKind}-${item.sourceRef}`} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* ── WOW-2D — À demander / confirmer (ask_confirm) ───────────────────── */}
      {hasAskConfirm && (
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            À demander / confirmer
          </h2>
          <div className="divide-y divide-foreground/[0.06] rounded-2xl border border-foreground/[0.06] bg-card px-4">
            {askConfirm.map((item) => (
              <CandidateRow key={`${item.sourceKind}-${item.sourceRef}`} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* ── Depuis votre dernière visite ────────────────────────────────────── */}
      {hasDelta && sinceLabel && (
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Depuis votre dernière visite ({sinceLabel})
          </h2>
          <div className="flex flex-wrap gap-3 rounded-2xl border border-foreground/[0.06] bg-card px-4 py-3">
            {delta.subjectsChanged > 0 && (
              <DeltaRow
                label={delta.subjectsChanged > 1 ? 'sujets ont évolué' : 'sujet a évolué'}
                value={delta.subjectsChanged}
                color="text-violet-600"
              />
            )}
            {delta.actionsCreated > 0 && (
              <DeltaRow
                label={delta.actionsCreated > 1 ? 'actions créées' : 'action créée'}
                value={delta.actionsCreated}
                color="text-rose-600"
              />
            )}
            {delta.actionsClosed > 0 && (
              <DeltaRow
                label={delta.actionsClosed > 1 ? 'actions clôturées' : 'action clôturée'}
                value={delta.actionsClosed}
                color="text-emerald-600"
              />
            )}
            {delta.reservesCreated > 0 && (
              <DeltaRow
                label={delta.reservesCreated > 1 ? 'réserves ouvertes' : 'réserve ouverte'}
                value={delta.reservesCreated}
                color="text-amber-600"
              />
            )}
            {delta.reservesLifted > 0 && (
              <DeltaRow
                label={delta.reservesLifted > 1 ? 'réserves levées' : 'réserve levée'}
                value={delta.reservesLifted}
                color="text-emerald-600"
              />
            )}
          </div>
        </section>
      )}

      {/* ── Section 3 : À ne pas oublier ────────────────────────────────────── */}
      {hasWatchlist && (
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            À ne pas oublier
          </h2>
          <Link
            href={`/sites/${siteId}/historique?view=lifelines`}
            className="flex items-center gap-3 rounded-2xl border border-foreground/[0.06] bg-card px-4 py-3 active:opacity-60"
          >
            <span className="mt-0.5 h-2 w-2 flex-none rounded-full bg-amber-400" aria-hidden />
            <span className="text-[14px] font-medium leading-snug text-foreground">
              {watchlistOpenCount} sujet{watchlistOpenCount > 1 ? 's' : ''} sous surveillance PV
            </span>
          </Link>
        </section>
      )}
    </div>
  )
}
