import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { MemoriaNeedsYouPill as PillData } from '@/lib/knowledge/tracked-point-needs-you-pill'

// 6E.4A.10 — signal d'attention, pas un bloc principal du chantier (mandat Vincent 2026-09-07).
// Placée entre "État du chantier" et "Tu dois faire" : jamais de rouge alarmiste hors tone
// "priority" (une vraie question PRIORITAIRE existe réellement, cf. tracked-point-needs-you-pill.ts).
const TONE_CLS: Record<PillData['tone'], string> = {
  default: 'border-violet-200 bg-violet-50/60 text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/20 dark:text-violet-100',
  priority: 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-100',
  historical: 'border-border bg-muted/30 text-muted-foreground',
}

export function MemoriaNeedsYouPill({ siteId, pill }: { siteId: string; pill: PillData }) {
  return (
    <Link
      href={`/m/site/${siteId}/besoin-de-toi`}
      className={`flex items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium active:brightness-95 ${TONE_CLS[pill.tone]}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden>🧠</span>
        <span className="truncate">{pill.label}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
    </Link>
  )
}
