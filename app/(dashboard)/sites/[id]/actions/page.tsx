import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, ShieldAlert, ListTodo } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayLocalIso } from '@/lib/time/local-date'
import { HubGrid } from '../HubGrid'

export const dynamic = 'force-dynamic'

export default async function SiteActionsHub({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')
  const { id } = await params
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  // Mini tableau de bord : compteurs des éléments à traiter.
  const sb = createAdminClient()
  const today = todayLocalIso()
  const [reservesRes, oblRes, actionsRes] = await Promise.all([
    sb.from('site_reserve').select('id', { count: 'exact', head: true }).eq('site_id', id).eq('status', 'open'),
    sb.from('site_obligation').select('id', { count: 'exact', head: true }).eq('site_id', id).in('status', ['a_produire', 'en_cours']),
    sb.from('site_actions').select('due_date').eq('site_id', id).eq('status', 'open'),
  ])
  const reservesOpen = reservesRes.count ?? 0
  const oblToDo = oblRes.count ?? 0
  const openActions = (actionsRes.data ?? []) as Array<{ due_date: string | null }>
  const overdue = openActions.filter((a) => a.due_date && a.due_date < today).length

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/sites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold"><ListTodo className="h-5 w-5" /> Actions</h1>
        <p className="text-sm text-muted-foreground">
          {openActions.length} action{openActions.length > 1 ? 's' : ''} ouverte{openActions.length > 1 ? 's' : ''}
          {overdue > 0 && <span className="text-rose-600"> · {overdue} en retard</span>} ·
          {' '}{reservesOpen} réserve{reservesOpen > 1 ? 's' : ''} · {oblToDo} obligation{oblToDo > 1 ? 's' : ''} à suivre.
        </p>
      </header>
      <HubGrid items={[
        { href: `/sites/${id}/reserves`, label: 'Points à lever', desc: 'Réserves ouvertes à lever.', icon: <ClipboardCheck className="h-5 w-5" />, badge: reservesOpen > 0 ? `${reservesOpen} ouverte${reservesOpen > 1 ? 's' : ''}` : null },
        { href: `/sites/${id}/obligations`, label: 'Obligations', desc: 'Obligations et contrôles à suivre.', icon: <ShieldAlert className="h-5 w-5" />, badge: oblToDo > 0 ? `${oblToDo} à suivre` : null },
      ]} />
    </div>
  )
}
