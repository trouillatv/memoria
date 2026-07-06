import { getCurrentUserWithProfile } from '@/lib/db/users'
import { MeetingLauncher } from '../MeetingLauncher'
import { VisitLauncherHome } from '../VisitLauncherHome'

export const dynamic = 'force-dynamic'

/**
 * « Commencer » — l'écran ouvert par le bouton central de la barre. Deux gestes
 * seulement : enregistrer une réunion, ou démarrer une NOUVELLE VISITE. La
 * prévisite AO n'est plus un bouton à part : c'est une INTENTION de visite (le
 * moteur est identique), demandée juste après (« Pourquoi êtes-vous ici ? »).
 */
export default async function DemarrerPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) return null

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Commencer</h1>
        <p className="text-sm text-muted-foreground">Que voulez-vous démarrer ?</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <MeetingLauncher />
        <VisitLauncherHome />
      </div>
    </div>
  )
}
