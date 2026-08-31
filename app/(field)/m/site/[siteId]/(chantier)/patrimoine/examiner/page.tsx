import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSiteAccess } from '@/lib/field/site-access'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMemoryReview } from '@/lib/knowledge/memory-review'
import { MemoryReviewPanel } from '../../../MemoryReviewPanel'

export const dynamic = 'force-dynamic'

/**
 * Écran dédié à la validation des propositions MemorIA.
 * Répond à « Qu'est-ce que MemorIA a compris, et est-ce juste ? »
 * Séparé du Patrimoine principal qui répond à « Qu'est-ce que ce chantier sait ? »
 * — les propositions non validées ne sont pas encore des faits.
 */
export default async function PatrimoineExaminerPage({
  params,
}: {
  params: Promise<{ siteId: string }>
}) {
  const { siteId } = await params
  const { user } = await requireSiteAccess(siteId)

  const supabase = createAdminClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name')
    .eq('id', siteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!site) notFound()

  const review = await getMemoryReview(siteId).catch(() => ({ confirmed: [], toReview: [] }))

  // On affiche uniquement les propositions à valider — les confirmées restent sur /patrimoine.
  const toReviewOnly = { confirmed: [], toReview: review.toReview }

  return (
    <div className="max-w-md space-y-5 pb-16">
      <header className="space-y-1">
        <Link
          href={`/m/site/${siteId}/patrimoine`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground active:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Patrimoine
        </Link>
        <div>
          <h1 className="text-xl font-semibold">À examiner</h1>
          <p className="text-[13px] text-muted-foreground">
            {review.toReview.length === 0
              ? 'Tout est à jour — aucune proposition en attente.'
              : `${review.toReview.length} proposition${review.toReview.length > 1 ? 's' : ''} de MemorIA attendent votre validation.`}
          </p>
        </div>
      </header>

      {review.toReview.length > 0 ? (
        <section className="rounded-2xl border bg-card p-4">
          <MemoryReviewPanel siteId={siteId} review={toReviewOnly} />
        </section>
      ) : (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Aucune proposition en attente. Le patrimoine est à jour.
          </p>
        </div>
      )}
    </div>
  )
}
