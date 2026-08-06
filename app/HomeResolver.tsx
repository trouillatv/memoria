'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { resolveHomeDestination } from '@/lib/navigation/home'
import type { UserRole } from '@/types/db'

/**
 * Résout la destination d'accueil côté client, après détection du mode d'affichage.
 * Rendu serveur impossible : display-mode n'existe que dans le navigateur.
 *
 * Doctrine :
 *   standalone (ancienne PWA start_url='/' ou nouvelle start_url='/pwa') → /m
 *   Chrome  + admin/manager → /dashboard
 *   Chrome  + chef_equipe   → /m  (via resolveHomeDestination)
 */
export function HomeResolver({ role }: { role: UserRole }) {
  const router = useRouter()
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
    router.replace(standalone ? '/m' : resolveHomeDestination(role))
  }, [role, router])
  return null
}
