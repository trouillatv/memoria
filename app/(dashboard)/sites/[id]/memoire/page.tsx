import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Sparkles, Layers, BookText } from 'lucide-react'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { getSiteIdentity } from '@/lib/db/site-cockpit'
import { createAdminClient } from '@/lib/supabase/admin'
import { HubGrid } from '../HubGrid'

export const dynamic = 'force-dynamic'

export default async function SiteMemoireHub({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')
  const { id } = await params
  const identity = await getSiteIdentity(id)
  if (!identity) notFound()

  const { count: subjectsCount } = await createAdminClient()
    .from('subjects').select('id', { count: 'exact', head: true }).eq('site_id', id).neq('status', 'closed')
  const subjects = subjectsCount ?? 0

  return (
    <div className="max-w-3xl space-y-6 py-6">
      <Link href={`/sites/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {identity.name}
      </Link>
      <header className="space-y-1">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold"><Sparkles className="h-5 w-5" /> Mémoire</h1>
        <p className="text-sm text-muted-foreground">Interroger et comprendre la mémoire du chantier.</p>
      </header>
      <HubGrid items={[
        { href: `/memoire/${id}`, label: 'Atelier mémoire', desc: 'Poser une question, explorer un sujet.', icon: <Sparkles className="h-5 w-5" /> },
        { href: `/sites/${id}/subjects`, label: 'Sujets', desc: "L'histoire complète de chaque problème.", icon: <Layers className="h-5 w-5" />, badge: subjects > 0 ? `${subjects} ouvert${subjects > 1 ? 's' : ''}` : null },
        { href: `/sites/${id}/recit`, label: 'Récit', desc: 'Lecture narrative du chantier.', icon: <BookText className="h-5 w-5" /> },
      ]} />
    </div>
  )
}
