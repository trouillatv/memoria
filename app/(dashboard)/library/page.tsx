import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { listKnowledgeItems, listAllTags } from '@/lib/db/knowledge'
import { KnowledgeItemTable } from './KnowledgeItemTable'
import { KnowledgeCategoryFilter } from './KnowledgeCategoryFilter'
import { KnowledgeTagsFilter } from './KnowledgeTagsFilter'
import { KnowledgeItemDrawer } from './KnowledgeItemDrawer'
import type { KnowledgeCategory } from '@/types/db'

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; tags?: string; search?: string }>
}) {
  const params = await searchParams
  const category = params.category as KnowledgeCategory | undefined
  const tags = params.tags ? params.tags.split(',').filter(Boolean) : undefined
  const search = params.search

  const [items, allTags] = await Promise.all([
    listKnowledgeItems({ category, tags, search }),
    listAllTags(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Bibliothèque AGP</h1>
          <p className="text-sm text-muted-foreground">
            Références clients, moyens, procédures, certifications. Utilisée par l&apos;IA pour grounder les réponses aux AO.
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
        <CardContent className="p-0">
          <KnowledgeItemTable items={items} />
        </CardContent>
      </Card>
    </div>
  )
}
