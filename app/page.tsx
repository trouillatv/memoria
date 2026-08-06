import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { resolveHomeDestination } from '@/lib/navigation/home'
import LandingPage from './LandingPage'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const profile = await getCurrentUserWithProfile()
    if (profile) {
      redirect(resolveHomeDestination(profile.role))
    }
    redirect('/dashboard')
  }
  return <LandingPage />
}
