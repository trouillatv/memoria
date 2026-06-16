import { redirect } from 'next/navigation'
import { Brain } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { OrgMemoryQuery } from './OrgMemoryQuery'

export const dynamic = 'force-dynamic'

export default async function MemoirePage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  return (
    <div className="space-y-6 w-full max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Brain className="h-5 w-5 text-muted-foreground" />
          Interroger l&apos;entreprise
        </h1>
        <p className="text-sm text-muted-foreground">
          Toute la mémoire des chantiers — anomalies, notes, interventions — en une question.
          Chaque trace est rattachée à son site.
        </p>
      </header>

      <OrgMemoryQuery />
    </div>
  )
}
