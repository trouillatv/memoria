import { NOUMEA_TZ } from '@/lib/time/local-date'
import type { SiteTodaySynthesis } from '@/lib/knowledge/site-today-synthesis'

// ── LOT 2 « Aujourd'hui » — synthèse d'en-tête, une phrase, jamais un tableau de bord ──

const dateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: NOUMEA_TZ, day: 'numeric', month: 'long' })

export function SiteTodaySynthesisLine({ synthesis }: { synthesis: SiteTodaySynthesis }) {
  const parts: string[] = []
  if (synthesis.openPoints > 0) parts.push(`${synthesis.openPoints} Point${synthesis.openPoints > 1 ? 's' : ''} ouvert${synthesis.openPoints > 1 ? 's' : ''}`)
  if (synthesis.reopenedPoints > 0) parts.push(`${synthesis.reopenedPoints} réouvert${synthesis.reopenedPoints > 1 ? 's' : ''}`)
  if (synthesis.resolvedRecently > 0) parts.push(`${synthesis.resolvedRecently} résolu${synthesis.resolvedRecently > 1 ? 's' : ''} récemment`)
  if (synthesis.needsYouCount > 0) parts.push(`${synthesis.needsYouCount} question${synthesis.needsYouCount > 1 ? 's' : ''} pour MemorIA`)

  if (parts.length === 0) {
    return <p className="text-sm text-muted-foreground">Rien de particulier à signaler aujourd&apos;hui.</p>
  }

  return (
    <p className="text-sm text-muted-foreground">
      {parts.join(' · ')}
      {synthesis.lastActivityAt && (
        <span> — dernière activité le {dateFmt.format(new Date(synthesis.lastActivityAt))}</span>
      )}
    </p>
  )
}
