'use client'

// ── OUVRIR UNE FICHE SANS CHANGER LE DÉCOR ───────────────────────────────────
// « Un clic = une continuité » : ouvrir une fiche ne doit JAMAIS modifier le
// contexte derrière elle. Or les liens de fiche sont construits côté serveur en
// ABSOLU (`/sites/<id>?action=<id>`) : ils écrasent la query courante, donc
// l'onglet actif (`tab=memoire`, `memtab=…`) disparaît et la page retombe sur
// l'onglet par défaut (Aperçu) derrière le panneau.
//
// Ce hook FUSIONNE les paramètres de la fiche dans la query courante :
//   · même page  → on conserve l'onglet, le sous-onglet, les filtres ;
//   · autre page → href inchangé (réunion, autre chantier) — la fiche cède la
//     place à une vraie navigation, c'est assumé (cf. Lot 3 « Navigation
//     contextuelle entre objets »).
// Un seul maillon actif à la fois : les autres paramètres de fiche sont purgés.

import { usePathname, useSearchParams } from 'next/navigation'

const FICHE_PARAMS = [
  'action', 'action_source', 'action_site',
  'decision', 'decision_source',
  'person', 'person_source',
] as const

export function useFicheHref(): (href: string | null | undefined) => string | null {
  const pathname = usePathname()
  const params = useSearchParams()

  return (href) => {
    if (!href) return null
    const [path, query = ''] = href.split('?')
    // Lien vers une AUTRE page : on n'y touche pas.
    if (path !== pathname) return href

    const next = new URLSearchParams(params?.toString() ?? '')
    for (const key of FICHE_PARAMS) next.delete(key)
    for (const [key, value] of new URLSearchParams(query)) next.set(key, value)
    const qs = next.toString()
    return qs ? `${path}?${qs}` : path
  }
}
