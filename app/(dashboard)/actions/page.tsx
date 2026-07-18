import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getActionsDashboard } from '@/lib/knowledge/actions-dashboard'
import { todayLocalIso } from '@/lib/time/local-date'
import { ActionsDashboard } from './ActionsDashboard'

export const dynamic = 'force-dynamic'

// Pilotage des engagements du chantier (Tranche 1). Read model unique
// getActionsDashboard : 5 KPIs réels, liste enrichie, filtres. Le détail d'une
// action ouvre la fiche canonique existante (Sheet ?action=). Réservé au pilotage.
export default async function ActionsPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/planning')

  const data = await getActionsDashboard()
  return (
    <div className="p-6">
      <ActionsDashboard data={data} today={todayLocalIso()} />
    </div>
  )
}
