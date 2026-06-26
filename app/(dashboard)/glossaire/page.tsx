// Glossaire métier (mig 150) — référentiel terme / définition / alias, par org.
// Géré à la main, destiné à nourrir les corrections de transcription. Pas de LLM.

export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listGlossaryTerms } from '@/lib/db/glossary'
import { GlossaryManager } from './GlossaryManager'

export default async function GlossairePage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  // LECTURE pour tous (Vincent 2026-06-27) : le glossaire aide tout le monde à
  // parler le même vocabulaire. ÉDITION réservée aux admins (référentiel partagé).
  const canEdit = user.role === 'admin'

  const terms = await listGlossaryTerms()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Glossaire métier</h1>
        <p className="text-sm text-muted-foreground">
          Le vocabulaire de votre métier (finisseur, grader, grave-bitume, PAQ, DOE…) et ses fautes
          fréquentes. Les alias sont <strong>corrigés automatiquement</strong> dans la transcription de
          vos prochaines réunions (ex. « finisher » → « finisseur ») et regroupent un même sujet à
          travers ses variantes (DOE = « Dossier des ouvrages exécutés »).
        </p>
        <p className="text-xs text-muted-foreground/80">
          {canEdit
            ? 'Termes de démarrage fournis — à adapter, compléter ou supprimer selon votre vocabulaire.'
            : 'Consultable par tous ; l’édition est réservée aux administrateurs.'}
        </p>
      </header>
      <GlossaryManager terms={terms} canEdit={canEdit} />
    </div>
  )
}
