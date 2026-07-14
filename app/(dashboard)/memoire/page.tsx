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
          Chaque trace est rattachée à son chantier.
        </p>
        {/* Les DEUX mémoires, nommées (doctrine 2026-07-13) : l'utilisateur doit
            comprendre pourquoi certaines connaissances se réutilisent partout. */}
        <p className="text-xs text-muted-foreground/80">
          Ici, c&apos;est la <strong>mémoire de l&apos;entreprise</strong> : ce que vos chantiers
          vous ont appris, réutilisable sur tous vos projets. La <strong>mémoire du
          chantier</strong> (visites, réunions, preuves) vit, elle, sur chaque fiche chantier.
        </p>
      </header>

      <OrgMemoryQuery />
    </div>
  )
}
