import Link from 'next/link'
import { ClipboardCheck, Clock, AlertTriangle, ChevronRight } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMemoryReview } from '@/lib/knowledge/memory-review'
import { deriveCanonicalAttentionItems } from '@/lib/knowledge/canonical-attention'

// ── BLOC "À TRAITER" ──────────────────────────────────────────────────────────
// Doctrine : signal d'intervention uniquement, jamais une liste exhaustive.
// 3 types possibles, max 3 lignes, bloc absent si rien à traiter.
//   1. Propositions IA en attente de validation (site_knowledge_proposals)
//   2. Actions en retard (site_actions status='open', due_date < today)
//   3. Sujet canonical critique ou important (deriveCanonicalAttentionItems)
//
// Différence avec État : État = ce qui existe ; À traiter = ce qui exige une décision.

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86_400_000)
}

export async function SiteToTreatSection({ siteId }: { siteId: string }) {
  const today = todayIso()
  const admin = createAdminClient()

  const [review, overdueRes, attentionItems] = await Promise.all([
    getMemoryReview(siteId).catch(() => ({ toReview: [], confirmed: [] })),
    admin
      .from('site_actions')
      .select('id, title, due_date')
      .eq('site_id', siteId)
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(5),
    deriveCanonicalAttentionItems(siteId, { limit: 2 }).catch(() => []),
  ])

  const proposals = review.toReview
  const overdueActions = (overdueRes.data ?? []) as Array<{ id: string; title: string; due_date: string }>
  // Seuls les sujets critiques ou importants méritent un signal dans "À traiter".
  const urgentItems = attentionItems.filter(i => i.urgency === 'critical' || i.urgency === 'high')

  if (proposals.length === 0 && overdueActions.length === 0 && urgentItems.length === 0) return null

  const mostOverdue = overdueActions[0]
  const overdueLabel = mostOverdue
    ? `Dont « ${mostOverdue.title} » · ${daysBetween(mostOverdue.due_date, today)} j`
    : null

  const topSubject = urgentItems[0]

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        À traiter
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border bg-card shadow-sm">
        {proposals.length > 0 && (
          <Link
            href={`/m/site/${siteId}/patrimoine/examiner`}
            className="flex items-center gap-3 px-4 py-3 active:brightness-95 transition"
          >
            <ClipboardCheck className="h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">
                {proposals.length} proposition{proposals.length > 1 ? 's' : ''} à examiner
              </p>
              <p className="text-[12px] text-muted-foreground">Issues des visites précédentes</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          </Link>
        )}

        {overdueActions.length > 0 && (
          <Link
            href={`/m/site/${siteId}/sujets`}
            className="flex items-center gap-3 px-4 py-3 active:brightness-95 transition"
          >
            <Clock className="h-4 w-4 shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">
                {overdueActions.length} action{overdueActions.length > 1 ? 's' : ''} en retard
              </p>
              {overdueLabel && (
                <p className="text-[12px] text-muted-foreground truncate">{overdueLabel}</p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          </Link>
        )}

        {topSubject && (
          <Link
            href={topSubject.href}
            className="flex items-center gap-3 px-4 py-3 active:brightness-95 transition"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-orange-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium truncate">{topSubject.title}</p>
              {topSubject.reasons[0] && (
                <p className="text-[12px] text-muted-foreground truncate">{topSubject.reasons[0]}</p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
          </Link>
        )}
      </div>
    </section>
  )
}

export function SiteToTreatSkeleton() {
  return (
    <section>
      <div className="mb-2 h-4 w-20 rounded bg-muted animate-pulse" />
      <div className="h-16 rounded-xl border bg-card animate-pulse" />
    </section>
  )
}
