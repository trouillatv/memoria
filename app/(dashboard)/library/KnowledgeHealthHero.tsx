import { Card, CardContent } from '@/components/ui/card'
import { Sparkles, AlertTriangle, TrendingUp } from 'lucide-react'
import { CATEGORY_TARGETS, CATEGORY_LABELS_FULL, CATEGORY_COLORS } from './category-targets'
import type { KnowledgeCategory, DbKnowledgeItem } from '@/types/db'

interface Props {
  items: DbKnowledgeItem[]
  totalTendersWithLibrary: number    // nb AO ayant injecté la biblio (30j)
  topCitedItems: Array<{ item: DbKnowledgeItem; count: number }>  // top 3 max
}

export function KnowledgeHealthHero({ items, totalTendersWithLibrary, topCitedItems }: Props) {
  const totalActive = items.length

  // Compte par catégorie
  const countByCategory = new Map<KnowledgeCategory, number>()
  for (const i of items) {
    countByCategory.set(i.category, (countByCategory.get(i.category) ?? 0) + 1)
  }

  // Catégories sous-cible
  const underAlimented = (Object.keys(CATEGORY_TARGETS) as KnowledgeCategory[])
    .filter((c) => (countByCategory.get(c) ?? 0) < CATEGORY_TARGETS[c])

  return (
    <Card>
      <CardContent className="pt-5 pb-5 space-y-4">
        {/* Header line */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-brand-600" />
            </div>
            <div>
              <div className="text-base font-semibold">Capital IA de l&apos;entreprise</div>
              <div className="text-xs text-muted-foreground">
                {totalActive} élément{totalActive > 1 ? 's' : ''} capitalisé{totalActive > 1 ? 's' : ''}
                {' · '}
                injecté dans {totalTendersWithLibrary} dossier{totalTendersWithLibrary > 1 ? 's' : ''} ce mois
              </div>
            </div>
          </div>
        </div>

        {/* 2 colonnes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Santé par catégorie */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Santé par catégorie
            </p>
            <ul className="space-y-1.5">
              {(Object.keys(CATEGORY_TARGETS) as KnowledgeCategory[]).map((cat) => {
                const current = countByCategory.get(cat) ?? 0
                const target = CATEGORY_TARGETS[cat]
                const ratio = Math.min(current / target, 1)
                const isComplete = current >= target
                const isCritical = current < target * 0.4
                const colors = CATEGORY_COLORS[cat]
                return (
                  <li key={cat} className="flex items-center gap-2 text-xs">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${colors.bg} ${colors.text}`}>
                      {CATEGORY_LABELS_FULL[cat]}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full transition-all ${isComplete ? 'bg-emerald-500' : isCritical ? 'bg-rose-400' : 'bg-amber-400'}`}
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground tabular-nums shrink-0 min-w-[2.5rem] text-right">
                      {current}/{target}
                    </span>
                    {isCritical && <AlertTriangle className="h-3 w-3 text-rose-500 shrink-0" />}
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Top 3 cités */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" />
              Top 3 mobilisés ce mois
            </p>
            {topCitedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Aucun item cité dans les 30 derniers jours.
              </p>
            ) : (
              <ol className="space-y-1.5 text-sm">
                {topCitedItems.slice(0, 3).map(({ item, count }, idx) => (
                  <li key={item.id} className="flex items-start gap-2">
                    <span className="text-muted-foreground tabular-nums shrink-0 w-4">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{item.title}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Cité {count}× ce mois · {CATEGORY_LABELS_FULL[item.category]}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {/* Warning footer si sous-alimenté */}
        {underAlimented.length > 0 && (
          <div className="flex items-start gap-2 pt-3 border-t text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
            <p>
              <strong>{underAlimented.length} catégorie{underAlimented.length > 1 ? 's' : ''} sous-alimentée{underAlimented.length > 1 ? 's' : ''}</strong>
              {' '}(<span className="font-mono">{underAlimented.map((c) => CATEGORY_LABELS_FULL[c]).join(', ')}</span>)
              {' '}— l&apos;IA aura moins de matière pour les futurs dossiers dans ces domaines.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
