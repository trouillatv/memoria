import type { ReactNode } from 'react'
import { getMemoryReview } from '@/lib/knowledge/memory-review'
import { getSiteCausalThreads } from '@/lib/knowledge/causal-threads'
import { buildSiteMemorySignals, type MemorySignal } from '@/lib/db/site-memory-signals'
import { listSubjectsBySite } from '@/lib/db/subjects'
import { listTeams } from '@/lib/db/teams'
import type { DbTeam } from '@/types/db'
import { SiteMemoryQuery } from '../../SiteMemoryQuery'
import { MemoireSubTabs, type MemoireSubTab } from './MemoireSubTabs'
import { MemoireConfirmer } from './MemoireConfirmer'
import { MemoireCausale } from './MemoireCausale'

// Extrait de page.tsx pour être monté par DEUX routes : l'onglet historique
// (`?tab=memoire`) et la route segmentée du prototype (`/sites/<id>/memoire`).
// Un seul composant, donc une seule vérité — la grammaire des fiches interdit
// d'avoir deux rendus concurrents du même écran.
export async function MemoireView({
  siteId,
  siteName,
  memtab,
}: {
  siteId: string
  siteName: string
  memtab: MemoireSubTab
}) {
  // « Mémoire du chantier » = l'endroit où l'on COMPREND et où l'on VALIDE — pas
  // l'endroit où l'on range tout. Deux axes : Pourquoi ? (chaînes causales) et
  // À confirmer (inbox des propositions IA). La Chronologie canonique vit dans la
  // navigation principale — un lien y renvoie, jamais un doublon. La recherche
  // reste le bloc commun. Même source que la Mémoire terrain (`getMemoryReview`).
  const review = await getMemoryReview(siteId).catch(() => ({ confirmed: [], toReview: [] }))

  // La recherche : commune aux deux lectures, mais jamais au premier plan dans
  // « À confirmer » (le centre y est l'inbox) — elle y passe en second plan.
  const searchBlock = (
    <section className="rounded-xl border bg-card p-3.5 shadow-sm">
      <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">Poser une question sur ce chantier</p>
      <SiteMemoryQuery siteId={siteId} />
    </section>
  )

  let content: ReactNode
  if (memtab === 'confirmer') {
    // Signaux et équipes ne servent QU'ICI : « Pourquoi ? » ne les paie plus.
    const [subjects, signals, teams] = await Promise.all([
      listSubjectsBySite(siteId).catch(() => []),
      buildSiteMemorySignals(siteId).catch((): MemorySignal[] => []),
      listTeams().catch((): DbTeam[] => []),
    ])
    content = (
      <MemoireConfirmer
        siteId={siteId}
        siteName={siteName}
        review={review}
        signals={signals}
        subjectsCount={subjects.length}
        teams={teams}
        searchSlot={searchBlock}
      />
    )
  } else {
    // Pourquoi ? — les chaînes causales validées (fils par engagement).
    content = (
      <div className="space-y-5">
        {searchBlock}
        <MemoireCausale threads={(await getSiteCausalThreads(siteId)) ?? []} siteId={siteId} />
      </div>
    )
  }

  return (
    <div>
      <MemoireSubTabs active={memtab} toConfirmCount={review.toReview.length} />
      {content}
    </div>
  )
}
