import { deriveCanonicalAttentionItems } from '@/lib/knowledge/canonical-attention'
import { loadTrackedPointReadModel } from '@/lib/knowledge/tracked-point-read-model'
import { loadMemoriaNeedsYouSummary } from '@/lib/knowledge/tracked-point-needs-you-summary'
import { selectLingeringPoints, loadSitePvDates, loadOpenActionCountBySubject } from '@/lib/knowledge/tracked-point-lingering'
import { computeSiteTodaySynthesis } from '@/lib/knowledge/site-today-synthesis'
import { buildActivitySinceLastPv } from '@/lib/knowledge/site-activity'
import { todayLocalIso } from '@/lib/time/local-date'
import { SiteTodaySynthesisLine } from '@/components/site/SiteTodaySynthesisLine'
import { SiteTodayAttentionList } from '@/components/site/SiteTodayAttentionList'
import { MemoriaNeedsYouBlock } from '@/components/site/MemoriaNeedsYouBlock'
import { SiteLingeringPointsBlock } from '@/components/site/SiteLingeringPointsBlock'
import { SincePvActivityBlock } from '@/components/site/SincePvActivityBlock'
import { CopilotBlock } from './CopilotBlock'

// ── ONGLET « AUJOURD'HUI » (LOT 2 + LOT 2.1 + LOT UX Cockpit+Points, mandat Vincent) ─
//
// Réponse à UNE question : « qu'est-ce qui mérite mon attention maintenant sur ce
// chantier ? ». Ordre figé (mandat Vincent 2026-09-11) : Synthèse chantier → Depuis le
// dernier PV → À surveiller → MemorIA a besoin de toi → Points qui traînent → Demander à
// MemorIA. Chaque bloc réutilise un moteur déjà gelé — aucun recalcul de score, d'état ou de tri :
//   - Synthèse chantier     : computeSiteTodaySynthesis (LOT 2.1, tally pur)
//   - Depuis le dernier PV  : buildActivitySinceLastPv (#230, LOT 2.1 — réintégration de
//                             l'ancien Aperçu, aucune logique recréée)
//   - À surveiller          : deriveCanonicalAttentionItems (P0-C/P2-2)
//   - MemorIA a besoin de toi : loadMemoriaNeedsYouSummary (6E.4A)
//   - Points qui traînent   : selectLingeringPoints (Lot 1 + attention canonique + actions ouvertes
//                             pour le départage, aucun nouveau score — cf. tracked-point-lingering.ts)
//   - Demander à MemorIA    : CopilotBlock (composant existant, réintégré tel quel — LOT 2.1)
//
// Écart de doctrine assumé (cf. rapport HARD STOP Lot 2) : `tests/lib/site-overview-tab
// .doctrine.test.ts` imposait un seul read-model (`getSiteOverview`) pour cet onglet.
// Le mandat de ce lot demande explicitement de recomposer des sources déjà gelées
// plutôt qu'une nouvelle fusion — le test a été mis à jour pour lister ces sources
// nommément (toujours aucun accès `lib/db/*`/Supabase direct).

const ATTENTION_CAP = 3

export async function SiteOverviewTab({ siteId }: { siteId: string }) {
  const today = todayLocalIso()

  const [attentionItems, pointModel, needsYou, pvDates, openActionCountBySubject, pvActivity] = await Promise.all([
    deriveCanonicalAttentionItems(siteId).catch(() => []),
    loadTrackedPointReadModel(siteId).catch(() => ({ points: [], mergedPoints: [], bySubject: new Map(), pendingIdentityCandidates: [] })),
    loadMemoriaNeedsYouSummary(siteId).catch(() => null),
    loadSitePvDates(siteId).catch(() => []),
    loadOpenActionCountBySubject(siteId).catch(() => new Map<string, number>()),
    buildActivitySinceLastPv(siteId).catch(() => null),
  ])

  const lingering = selectLingeringPoints(pointModel.points, today, pvDates, { attentionItems, openActionCountBySubject })
  const synthesis = computeSiteTodaySynthesis(pointModel.points, needsYou?.totalCount ?? 0, today)

  const pointHrefPrefix = `/sites/${siteId}/point`

  return (
    <main className="space-y-5">
      <SiteTodaySynthesisLine synthesis={synthesis} />

      {pvActivity && <SincePvActivityBlock activity={pvActivity} />}

      <section aria-labelledby="today-attention" className="space-y-3">
        <div>
          <h2 id="today-attention" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            À surveiller
          </h2>
          <p className="text-xs text-muted-foreground">Risques ou sujets qui demandent attention maintenant</p>
        </div>
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
        <div>
          <h2 id="today-lingering" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Points qui traînent
          </h2>
          <p className="text-xs text-muted-foreground">Situations ouvertes qui stagnent malgré l&apos;activité du chantier</p>
        </div>
        <SiteLingeringPointsBlock
          entries={lingering}
          seeAllHref={`/sites/${siteId}/points`}
          pointHrefPrefix={pointHrefPrefix}
        />
      </section>

      <CopilotBlock siteId={siteId} />
    </main>
  )
}
