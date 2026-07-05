import { getCurrentUserWithProfile } from '@/lib/db/users'
import { MeetingLauncher } from '../MeetingLauncher'
import { VisitLauncherHome } from '../VisitLauncherHome'
import { PrevisiteAoLauncher } from '../PrevisiteAoLauncher'

export const dynamic = 'force-dynamic'

/**
 * « Commencer » — l'écran ouvert par le bouton central Visite de la barre. L'action
 * principale du terrain (démarrer une visite) est ainsi accessible en 1 tap depuis
 * n'importe où. Réutilise les lanceurs existants (réunion / visite / prévisite) —
 * pas de nouvelle logique. La visite propose ensuite ses modes (capturer / WhatsApp
 * / fichiers).
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

      <div className="grid grid-cols-3 gap-3">
        <MeetingLauncher />
        <VisitLauncherHome />
        <PrevisiteAoLauncher />
      </div>
    </div>
  )
}
