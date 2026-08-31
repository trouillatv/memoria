import { listOpenSiteActions, type SiteActionRow } from '@/lib/db/site-actions'
import { getPendingWork } from '@/lib/knowledge/pending-work'
import { resolveActionProvenanceLines } from '@/lib/knowledge/action-provenance-cards'
import { FieldActionsList } from '@/components/actions/FieldActionsList'
import { PendingWorkBlock } from './PendingWorkBlock'

// Le moteur Actions UNIFIÉ (À confirmer + actions existantes), scopé ou global.
// Une seule vérité, réutilisée strictement par :
//   • /m/actions  (barre du bas, global ou ?site=…)
//   • /m/site/[siteId]/actions  (pill, sous le layout chantier)
// Mêmes read-models, mêmes composants, mêmes gestes — jamais un second système.
export async function ActionsEnginePanel({ siteId }: { siteId?: string }) {
  const scoped = typeof siteId === 'string' && siteId.length > 0
  const [actions, pending] = await Promise.all([
    listOpenSiteActions(scoped ? { siteIds: [siteId!] } : undefined).catch(() => [] as SiteActionRow[]),
    getPendingWork(scoped ? { siteIds: [siteId!] } : {}).catch(() => ({ actions: [], deadlines: [] })),
  ])
  const provenance = await resolveActionProvenanceLines(actions).catch(() => ({}))

  return (
    <>
      {/* DEUX BLOCS jamais mélangés : propositions « À confirmer » ≠ actions existantes. */}
      <PendingWorkBlock work={pending} />
      <FieldActionsList actions={actions} scopedSiteId={scoped ? siteId : undefined} provenance={provenance} />
    </>
  )
}
