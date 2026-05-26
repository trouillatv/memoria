import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LandingPage from './LandingPage'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Utilisateur déjà connecté → cockpit mémoriel (le layout dashboard renverra
  // un chef_equipe vers /m). /missions est une liste ERP, pas une porte d'entrée.
  if (user) redirect('/dashboard')
  return <LandingPage />
}
