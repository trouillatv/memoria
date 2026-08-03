'use client'

// Protection "Chrome Android en mode bureau" :
// Le serveur ne connaît pas window.innerWidth — il se fie à l'UA. Quand Chrome
// est en "site pour ordinateur" sur un téléphone, l'UA ne contient plus "Mobile"
// et le serveur route vers /dashboard. Mais le vrai viewport est celui du téléphone
// (< 640px). Ce composant détecte ce cas côté client et redirige vers /m.
//
// La garde ne se déclenche QUE quand le serveur a conclu "desktop" (serverSaidDesktop=true).
// Si le serveur a dit "mobile", l'UA et le viewport sont cohérents — rien à corriger.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const DASHBOARD_MIN_WIDTH = 640

interface ViewportGuardProps {
  serverSaidDesktop: boolean
}

export function ViewportGuard({ serverSaidDesktop }: ViewportGuardProps) {
  const router = useRouter()

  useEffect(() => {
    if (!serverSaidDesktop) return
    if (window.innerWidth < DASHBOARD_MIN_WIDTH) {
      router.replace('/m')
    }
  }, [router, serverSaidDesktop])

  return null
}
