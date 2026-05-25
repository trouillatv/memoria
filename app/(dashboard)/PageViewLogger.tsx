'use client'

// Logge la route visitée à chaque navigation (feedback produit : adoption des
// menus). Monté une fois dans le layout (dashboard). Best-effort, silencieux.

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { logPageViewAction } from './page-view-action'

export function PageViewLogger() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname) void logPageViewAction(pathname)
  }, [pathname])
  return null
}
