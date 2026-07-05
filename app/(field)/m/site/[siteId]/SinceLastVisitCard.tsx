import { History, CheckSquare, ClipboardList, Users, Camera } from 'lucide-react'
import type { SinceLastVisitSummary } from '@/lib/db/visits'

/**
 * « Depuis votre dernière visite » — résumé déterministe de ce qui a bougé sur le
 * chantier depuis la dernière visite terminée. Une puce par type d'événement, et
 * uniquement ceux qui ont un compte non nul (silence positif). Aucune IA : simple
 * lecture des objets réels. Donne le sentiment que MemorIA « suit » le chantier.
 */
export function SinceLastVisitCard({ summary }: { summary: SinceLastVisitSummary }) {
  const lines: { key: string; Icon: typeof CheckSquare; cls: string; text: string }[] = []
  if (summary.actionsDone > 0)
    lines.push({ key: 'a', Icon: CheckSquare, cls: 'text-emerald-600', text: `${summary.actionsDone} action${summary.actionsDone > 1 ? 's' : ''} terminée${summary.actionsDone > 1 ? 's' : ''}` })
  if (summary.newReserves > 0)
    lines.push({ key: 'r', Icon: ClipboardList, cls: 'text-rose-600', text: `${summary.newReserves} nouvelle${summary.newReserves > 1 ? 's' : ''} réserve${summary.newReserves > 1 ? 's' : ''}` })
  if (summary.meetings > 0)
    lines.push({ key: 'm', Icon: Users, cls: 'text-sky-600', text: `${summary.meetings} réunion${summary.meetings > 1 ? 's' : ''}` })
  if (summary.newPhotos > 0)
    lines.push({ key: 'p', Icon: Camera, cls: 'text-violet-600', text: `${summary.newPhotos} nouvelle${summary.newPhotos > 1 ? 's' : ''} photo${summary.newPhotos > 1 ? 's' : ''}` })

  if (lines.length === 0) return null

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-2.5">
      <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
        <History className="h-4 w-4 text-muted-foreground" />
        Depuis votre dernière visite
        <span className="font-normal text-muted-foreground first-letter:lowercase">· {summary.dateLabel}</span>
      </h2>
      <ul className="space-y-1.5">
        {lines.map(({ key, Icon, cls, text }) => (
          <li key={key} className="flex items-center gap-2 text-sm">
            <Icon className={`h-4 w-4 shrink-0 ${cls}`} />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
