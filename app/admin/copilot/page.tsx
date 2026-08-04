import { BotMessageSquare } from 'lucide-react'
import {
  getCopilotStats,
  getCopilotScopeBreakdown,
  listCopilotInteractions,
} from '@/lib/db/copilot-interactions-read'
import { CopilotJournalShell } from './CopilotJournalShell'

export const dynamic = 'force-dynamic'

export default async function AdminCopilotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const days    = Math.min(Math.max(parseInt(sp.days ?? '30', 10) || 30, 1), 365)
  const siteId  = sp.site ?? null
  const scope   = sp.scope ?? null
  const answerStatus = sp.answer_status ?? null
  const answerMode   = sp.answer_mode   ?? null
  const search  = sp.q ?? null
  const page    = Math.max(parseInt(sp.page ?? '1', 10) || 1, 1)
  const limit   = 50
  const offset  = (page - 1) * limit

  const [stats, scopeBreakdown, { rows, total }] = await Promise.all([
    getCopilotStats(days),
    getCopilotScopeBreakdown(days),
    listCopilotInteractions({ days, siteId, scope, answerStatus, answerMode, search, limit, offset }),
  ])

  return (
    <div className="space-y-6 w-full">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <BotMessageSquare className="h-6 w-6 text-brand-600" />
          Observatoire Copilote
        </h1>
        <p className="text-sm text-muted-foreground">
          Journal réel des échanges avec le Copilote — phase pilote.
          Cliquer sur une ligne pour voir le détail complet.
        </p>
      </header>

      <CopilotJournalShell
        stats={stats}
        scopeBreakdown={scopeBreakdown}
        rows={rows}
        total={total}
        filters={{ days, siteId, scope, answerStatus, answerMode, search, page }}
      />
    </div>
  )
}
