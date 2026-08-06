import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { HomeResolver } from './HomeResolver'
import { StandaloneLoginRedirect } from './StandaloneLoginRedirect'
import LandingPage from './LandingPage'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const profile = await getCurrentUserWithProfile()
    if (profile) {
      // Résolution côté client : le serveur ne connaît pas display-mode.
      // HomeResolver redirige vers /m (standalone) ou resolveHomeDestination(role).
      return <HomeResolver role={profile.role} />
    }
    redirect('/dashboard')
  }
  return (
    <>
      {/* Couche de compatibilité : ancienne PWA non auth → login?next=/m. */}
      <StandaloneLoginRedirect />
      <LandingPage />
    </>
  )
}
