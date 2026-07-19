'use client'

// ── LE FIL — « où suis-je dans l'histoire » ──────────────────────────────────
// Lot 1 « Orientation » du parcours. INTÉGRÉ à l'en-tête d'une fiche (jamais une
// carte ni un widget) : une ligne compacte « Réunion › Décision › Action » avec un
// point sous le maillon COURANT. Le point EST le langage — pas de « vous êtes ici ».
// Il se déplace d'une fiche à l'autre : le même fil, un autre point actif.
//
// Deux sorties, jamais confondues (règle « un clic = une continuité ») :
//   · `back` présent → on est arrivé depuis une autre fiche → « ← <maillon> »
//     REMONTE l'histoire (le × est masqué par la fiche).
//   · `back` absent → on est arrivé en direct (Travail, Chronologie, recherche) →
//     la fiche garde son × « Fermer ».
// Pas de sous-titre « Depuis : … » : le fil au-dessus et le libellé du bouton le
// disent déjà (version A retenue — la redondance n'ajoutait rien).
//
// Présentationnel pur : les nœuds et le retour sont calculés par la fiche / le
// deep-link à partir de données DÉJÀ chargées. Aucun objet, aucune requête neuve.

import { Fragment } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Un maillon du fil : un TYPE court (« Réunion », « Décision », « Action »), pas
 *  le titre de l'objet — le titre reste la vedette, en dessous, dans la fiche. */
export interface TrailNode {
  typeLabel: string
  href: string | null
  current: boolean
}

/** Le maillon d'où l'on vient, quand on est arrivé depuis une autre fiche. */
export interface TrailBack {
  typeLabel: string
  href: string
}

export function FicheTrail({ nodes, back }: { nodes: TrailNode[]; back?: TrailBack | null }) {
  const showFil = nodes.length >= 2
  if (!showFil && !back) return null

  return (
    <div className="mb-1.5 space-y-1">
      {back && (
        <Link
          href={back.href}
          scroll={false}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden className="text-[13px]">←</span> {back.typeLabel}
        </Link>
      )}

      {showFil && (
        // flex-wrap : sur mobile étroit, un maillon à long libellé passe à la ligne
        // avec son point, plutôt que de déborder du panneau.
        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1">
          {nodes.map((n, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden className="text-[12px] leading-5 text-muted-foreground/40">›</span>}
              <span className="flex flex-col items-center">
                {n.href && !n.current ? (
                  <Link href={n.href} scroll={false} className="text-[12px] leading-5 text-muted-foreground hover:text-foreground">
                    {n.typeLabel}
                  </Link>
                ) : (
                  <span className={cn('text-[12px] leading-5', n.current ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                    {n.typeLabel}
                  </span>
                )}
                {/* Le point : le maillon courant seul le porte. */}
                <span aria-hidden className={cn('mt-[3px] h-[5px] w-[5px] rounded-full', n.current ? 'bg-foreground' : 'bg-transparent')} />
              </span>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
