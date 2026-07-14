import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { requireDeskUser } from '@/lib/auth/page-guard'
import { listKnowledgeItems, listAllTags } from '@/lib/db/knowledge'
import { getLibraryUsageCounts, countTendersUsingLibraryThisMonth } from '@/lib/db/library-usage'
import { KnowledgeCategoryFilter } from './KnowledgeCategoryFilter'
import { KnowledgeTagsFilter } from './KnowledgeTagsFilter'
import { KnowledgeItemDrawer } from './KnowledgeItemDrawer'
import { KnowledgeHealthHero } from './KnowledgeHealthHero'
import { LibraryViewToggle } from './LibraryViewToggle'
import type { KnowledgeCategory } from '@/types/db'

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; tags?: string; search?: string }>
}) {
  await requireDeskUser()
  const params = await searchParams
  const category = params.category as KnowledgeCategory | undefined
  const tags = params.tags ? params.tags.split(',').filter(Boolean) : undefined
  const search = params.search

  const [items, allTags, usageCountsMap, totalTendersWithLibrary] = await Promise.all([
    listKnowledgeItems({ category, tags, search }),
    listAllTags(),
    getLibraryUsageCounts({ sinceDays: 30 }),
    countTendersUsingLibraryThisMonth(),
  ])

  // Top 3 cités (intersection avec items visibles)
  const topCited = Array.from(usageCountsMap.entries())
    .map(([id, count]) => {
      const item = items.find((i) => i.id === id)
      return item ? { item, count } : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  // Si on filtre sur catégorie/tags/search, le hero doit montrer la santé GLOBALE de la biblio
  // → fetch tous les items NON filtrés pour le hero (light query)
  const allItems = (category || tags || search)
    ? await listKnowledgeItems({})
    : items

  // Map → object pour passer en prop client
  const usageCountsObj: Record<string, number> = {}
  for (const [id, count] of usageCountsMap) usageCountsObj[id] = count

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Bibliothèque</h1>
          <p className="text-sm text-muted-foreground">
            Capital IA de votre entreprise. Plus elle est riche, plus vos analyses de dossiers sont précises.
          </p>
        </div>
        <KnowledgeItemDrawer
          trigger={
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              Ajouter
            </Button>
          }
        />
      </div>

      {/* HERO */}
      <KnowledgeHealthHero
        items={allItems}
        totalTendersWithLibrary={totalTendersWithLibrary}
        topCitedItems={topCited}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtres</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form>
            <Input
              type="search"
              name="search"
              placeholder="Rechercher dans les titres et contenus…"
              defaultValue={search ?? ''}
            />
          </form>
          <KnowledgeCategoryFilter />
          <KnowledgeTagsFilter allTags={allTags} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {items.length} élément{items.length > 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LibraryViewToggle items={items} usageCounts={usageCountsObj} />
        </CardContent>
      </Card>
    </div>
  )
}
