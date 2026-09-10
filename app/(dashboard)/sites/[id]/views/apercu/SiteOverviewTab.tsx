import { deriveCanonicalAttentionItems } from '@/lib/knowledge/canonical-attention'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { loadMemoriaNeedsYouSummary } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { selectLingeringPoints, loadSitePvDates, loadOpenActionCountBySubject } from '@/lib/knowledge/tracked-point-lingering'
import { computeSiteTodaySynthesis } from '@/lib/knowledge/site-today-synthesis'
import { todayLocalIso } from '@/lib/time/local-date'
import { SiteTodaySynthesisLine } from '@/components/site/SiteTodaySynthesisLine'
import { SiteTodayAttentionList } from '@/components/site/SiteTodayAttentionList'
import { MemoriaNeedsYouBlock } from '@/components/site/MemoriaNeedsYouBlock'
import { SiteLingeringPointsBlock } from '@/components/site/SiteLingeringPointsBlock'

// ── ONGLET « AUJOURD'HUI » (LOT 2, mandat Vincent) ──────────────────────────
//
// Réponse à UNE question : « qu'est-ce qui mérite mon attention maintenant sur ce
// chantier ? ». Trois blocs, jamais un nouveau tableau de bord : À surveiller → MemorIA
// a besoin de toi → Points qui traînent. Chaque bloc réutilise un moteur déjà gelé —
// aucun recalcul de score, d'état ou de tri :
//   - À surveiller          : deriveCanonicalAttentionItems (P0-C/P2-2)
//   - MemorIA a besoin de toi : loadMemoriaNeedsYouSummary (6E.4A)
//   - Points qui traînent   : selectLingeringPoints (Lot 1 + attention canonique + actions ouvertes
//                             pour le départage, aucun nouveau score — cf. tracked-point-lingering.ts)
//
// Écart de doctrine assumé (cf. rapport HARD STOP Lot 2) : `tests/lib/site-overview-tab
// .doctrine.test.ts` imposait un seul read-model (`getSiteOverview`) pour cet onglet.
// Le mandat de ce lot demande explicitement de recomposer trois sources déjà gelées
// plutôt qu'une nouvelle fusion — le test a été mis à jour pour lister ces sources
// nommément (toujours aucun accès `lib/db/*`/Supabase direct).

const ATTENTION_CAP = 3

export async function SiteOverviewTab({ siteId }: { siteId: string }) {
  const today = todayLocalIso()

  const [attentionItems, pointModel, needsYou, pvDates, openActionCountBySubject] = await Promise.all([
    deriveCanonicalAttentionItems(siteId).catch(() => []),
    loadTrackedPointReadModel(siteId).catch(() => ({ points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] })),
    loadMemoriaNeedsYouSummary(siteId).catch(() => null),
    loadSitePvDates(siteId).catch(() => []),
    loadOpenActionCountBySubject(siteId).catch(() => new Map<string, number>()),
  ])

  const lingering = selectLingeringPoints(pointModel.points, today, pvDates, { attentionItems, openActionCountBySubject })
  const synthesis = computeSiteTodaySynthesis(pointModel.points, needsYou?.totalCount ?? 0, today)

  const pointHrefPrefix = `/sites/${siteId}/point`

  return (
    <main className="space-y-5">
      <SiteTodaySynthesisLine synthesis={synthesis} />

      <section aria-labelledby="today-attention" className="space-y-3">
        <h2 id="today-attention" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          À surveiller
        </h2>
        <SiteTodayAttentionList
          items={attentionItems}
          bySubject={pointModel.bySubject}
          cap={ATTENTION_CAP}
          seeAllHref={`/sites/${siteId}/historique?view=attention`}
          pointHrefPrefix={pointHrefPrefix}
        />
      </section>

      {needsYou && (
        <MemoriaNeedsYouBlock summary={needsYou} seeAllHref={`/sites/${siteId}/besoin-de-toi`} />
      )}

      <section aria-labelledby="today-lingering" className="space-y-3">
        <h2 id="today-lingering" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Points qui traînent
        </h2>
        <SiteLingeringPointsBlock
          entries={lingering}
          seeAllHref={`/sites/${siteId}/points`}
          pointHrefPrefix={pointHrefPrefix}
        />
      </section>
    </main>
  )
}
