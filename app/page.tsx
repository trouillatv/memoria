import { headers, cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { resolveHomeDestination, isMobileUserAgent } from '@/lib/navigation/home'
import { COOKIE_PWA_STANDALONE } from '@/lib/navigation/pwa-mode'
import LandingPage from './LandingPage'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Utilisateur déjà connecté → cockpit mémoriel (le layout dashboard renverra
  // un chef_equipe vers /m). /missions est une liste ERP, pas une porte d'entrée.
  if (user) {
    const profile = await getCurrentUserWithProfile()
    if (profile) {
      const jar = await cookies()
      const ua = (await headers()).get('user-agent')
      const isPwa = jar.get(COOKIE_PWA_STANDALONE)?.value === '1'
      redirect(resolveHomeDestination(profile, isMobileUserAgent(ua), isPwa))
    }
    redirect('/dashboard')
  }
  return <LandingPage />
}
