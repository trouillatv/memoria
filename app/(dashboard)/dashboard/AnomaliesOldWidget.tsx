import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  oldCount: number
}

/**
 * Widget « Anomalies +3 jours » (Slice 11.3).
 *
 * Affiche une alerte sobre uniquement si oldCount > 0.
 * Différent du compteur du StatsBand : ici on invite à l'action (lien direct).
 *
 * Doctrine V3 : pas de couleur alarmante (rouge), ambre/sobre. Aucune
 * mention d'agent — c'est un compteur factuel cross-anomalie.
 */
export function AnomaliesOldWidget({ oldCount }: Props) {
  if (oldCount === 0) return null

  const plural = oldCount > 1
  return (
    <Card data-slot="anomalies-old">
      <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" strokeWidth={1.75} />
          <div>
            <h3 className="text-sm font-semibold">
              {oldCount} anomalie{plural ? 's' : ''} ouverte{plural ? 's' : ''} depuis plus de 3 jours
            </h3>
            <p className="text-xs text-muted-foreground">À résoudre ou clôturer.</p>
          </div>
        </div>
        <Link href="/missions?status=in_progress">
          <Button variant="outline" size="sm">
            Voir
            <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}
