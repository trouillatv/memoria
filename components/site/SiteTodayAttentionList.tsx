import Link from 'next/link'
import { CanonicalAttentionRow } from '@/components/site/CanonicalAttentionRow'
import { sliceOverview } from '@/lib/knowledge/overview-counter'
import type { CanonicalAttentionItem } from '@/lib/knowledge/canonical-attention'
import type { SubjectPointReadModel } from '@/lib/knowledge/tracked-point-read-model'

// ── LOT 2 « Aujourd'hui » — Bloc 1 « À surveiller » ──
//
// Réutilise `deriveCanonicalAttentionItems` tel quel (population + tri déjà déterministes,
// gelés) : ce composant ne fait qu'un plafond d'affichage (`sliceOverview`, #231) et une
// jointure de lecture avec le read-model Points (Lot 1) pour offrir un lien direct au Point
// quand le sujet n'en porte qu'un seul, ou un compteur sinon. Aucun recalcul de score/tri.

export interface SiteTodayAttentionListProps {
  items: CanonicalAttentionItem[]
  bySubject: Map<string, SubjectPointReadModel>
  cap: number
  seeAllHref: string
  /** Préfixe de fiche Point (`/sites/<id>/point` ou `/m/site/<siteId>/point`). */
  pointHrefPrefix: string
  /** Lot 2 — préfixe de fiche Sujet à utiliser en repli quand le sujet ne porte pas exactement
   *  un seul Point (`/sites/<id>/historique/sujets` ou `/m/site/<siteId>/sujets`). Si omis, repli
   *  sur `item.href` (route desktop câblée dans `deriveCanonicalAttentionItems`) — à ne PAS omettre
   *  sur mobile, sous peine de naviguer vers une route desktop. */
  subjectHrefPrefix?: string
}

export function SiteTodayAttentionList({ items, bySubject, cap, seeAllHref, pointHrefPrefix, subjectHrefPrefix }: SiteTodayAttentionListProps) {
  const { shown, total, hiddenCount } = sliceOverview(items, cap)

  if (total === 0) {
    return (
      <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
        Rien à surveiller sur ce chantier pour le moment.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {shown.map((item) => {
          const subj = bySubject.get(item.canonicalSubjectId)
          const singlePoint = subj && subj.totalPoints === 1 ? subj.points[0] : null
          return (
            <li key={item.canonicalSubjectId}>
              <CanonicalAttentionRow
                item={item}
                pointCount={subj ? subj.totalPoints : null}
                pointHref={singlePoint ? `${pointHrefPrefix}/${singlePoint.id}` : null}
                subjectHref={subjectHrefPrefix ? `${subjectHrefPrefix}/${item.canonicalSubjectId}` : null}
              />
            </li>
          )
        })}
      </ul>
      {hiddenCount > 0 && (
        <Link href={seeAllHref} className="inline-block pl-1 text-xs font-medium text-primary hover:underline">
          +{hiddenCount} autre{hiddenCount > 1 ? 's' : ''} sujet{hiddenCount > 1 ? 's' : ''} à surveiller
        </Link>
      )}
    </div>
  )
}
