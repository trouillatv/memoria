// AO-1 L1 — Bandeau vigilance rouge : AO à rendre ≤ 7 jours.
//
// Vincent 2026-05-21 : « ajouter une alerte si un AO est à rendre dans ≤ 7
// jours ; wording factuel, pas alarmiste ; lien vers l'AO concerné ».
//
// Doctrine : zone vigilance dashboard (V6.2 — rouge bordeaux sobre, en haut).
// Cf. mémoires `alertes-doctrine-legere` + `cadrage-strategique-2026-05-20`.
//
// Silence positif : si aucun AO à rendre dans 7j, le composant retourne null
// → le bandeau ne s'affiche pas.

import Link from 'next/link'
import { FileText, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { TenderDueSoonRow } from '@/lib/db/dashboard'

const MONTHS_FR_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

function formatDeadlineFr(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS_FR_SHORT[m - 1] ?? ''} ${y}`
}

function deadlineHint(daysUntilDeadline: number): string {
  if (daysUntilDeadline < 0) return 'passée'
  if (daysUntilDeadline === 0) return "aujourd'hui"
  if (daysUntilDeadline === 1) return 'demain'
  return `dans ${daysUntilDeadline} jours`
}

interface Props {
  tenders: TenderDueSoonRow[]
}

export function TendersDueSoonAlertWidget({ tenders }: Props) {
  if (tenders.length === 0) return null

  return (
    <Card
      data-slot="tenders-due-soon"
      className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900/40"
    >
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText
            className="h-4 w-4 text-red-700 dark:text-red-300 shrink-0"
            strokeWidth={2}
          />
          <h3 className="text-sm font-semibold text-red-900 dark:text-red-100">
            {tenders.length === 1
              ? '1 dossier à rendre dans les 7 jours'
              : `${tenders.length} dossiers à rendre dans les 7 jours`}
          </h3>
        </div>
        <ul className="space-y-2">
          {tenders.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tenders/${t.id}`}
                className="flex items-start justify-between gap-3 rounded-lg hover:bg-red-100/60 dark:hover:bg-red-950/40 px-2 py-1.5 -mx-2 transition-colors group"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium block truncate text-red-950 dark:text-red-50">
                    {t.title}
                  </span>
                  {t.client_name && (
                    <span className="text-xs text-red-900/70 dark:text-red-200/70 truncate">
                      {t.client_name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-red-900/80 dark:text-red-200/80 tabular-nums text-right">
                    <span className="block font-semibold">{formatDeadlineFr(t.deadline)}</span>
                    <span className="text-[10px] text-red-900/60 dark:text-red-200/60">
                      {deadlineHint(t.daysUntilDeadline)}
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-red-900/60 dark:text-red-200/60 group-hover:text-red-950 dark:group-hover:text-red-50 transition-colors mt-1" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
