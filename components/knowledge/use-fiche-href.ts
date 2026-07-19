'use client'

// Le hook client autour de `mergeFicheHref` (logique pure dans lib/knowledge).
// Ouvrir une fiche conserve l'onglet, le sous-onglet et les filtres courants.

import { usePathname, useSearchParams } from 'next/navigation'
import { mergeFicheHref } from '@/lib/knowledge/fiche-href'

export function useFicheHref(): (href: string | null | undefined) => string | null {
  const pathname = usePathname()
  const params = useSearchParams()
  return (href) => mergeFicheHref(pathname, params?.toString() ?? '', href)
}
