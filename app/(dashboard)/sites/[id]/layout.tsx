import type { ReactNode } from 'react'

// ── PROTOTYPE Lot 3 · découpler l'objet affiché du contenu de l'onglet ───────
// Ce layout n'ajoute AUCUN habillage : il déclare seulement une seconde zone
// d'affichage, `fiche`, à côté du contenu habituel.
//
// L'intérêt est là : ouvrir une fiche ne change que le segment de la zone
// `fiche`. Le segment de `children` — la page du chantier et son onglet — reste
// identique, donc Next le réutilise au lieu de le recalculer. C'est exactement
// ce que la mesure doit confirmer (~3 s aujourd'hui pour un contenu inchangé).
//
// Les onglets restent des paramètres (`?tab=`) : on ne migre PAS l'espace
// `/sites/<id>/<segment>`, déjà occupé par une quinzaine de routes héritées.
// Le prototype ne bouge qu'une seule chose à la fois.
export default function SiteLayout({
  children,
  fiche,
}: {
  children: ReactNode
  fiche: ReactNode
}) {
  return (
    <>
      {children}
      {fiche}
    </>
  )
}
