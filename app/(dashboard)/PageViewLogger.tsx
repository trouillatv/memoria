'use client'

// Logge la route visitée à chaque navigation (feedback produit : adoption des
// menus). Monté une fois dans le layout (dashboard). Best-effort, silencieux.

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { logPageViewAction } from './page-view-action'

export function PageViewLogger() {
  const pathname = usePathname()
  // usePathname() ne porte jamais la query string : seuls tab/plantab sont
  // capturés (whitelist côté serveur, cf. page-view-action.ts) pour distinguer
  // les onglets desktop navigués par ?tab=… (FIX_REQUIRED Thread C, 2026-09-22).
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const plantab = searchParams.get('plantab')
  useEffect(() => {
    if (pathname) void logPageViewAction(pathname, { tab, plantab })
  }, [pathname, tab, plantab])
  return null
}
