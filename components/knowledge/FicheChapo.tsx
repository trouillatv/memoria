'use client'

// ── LE CHAPÔ — « pourquoi cet objet compte » ─────────────────────────────────
// Sous le titre : le verbe de relation (gris, discret) + l'objet cible (le LIEN).
// Deux héros seulement — le titre et l'objet lié ; le verbe s'efface. Pas de
// pastille colorée : le fil au-dessus porte déjà du bleu, un badge en créerait un
// 3ᵉ niveau. Lu ensemble, fil + chapô forment une phrase (« Je suis une Action,
// elle découle de cette Décision »).
//
// UNE seule relation centrale par fiche — jamais un inventaire (règle Vincent) :
// l'objet dit son RÔLE dans la chaîne. Le verbe vient du TYPE de fiche (Action →
// « Découle de », Décision → « Produit »…). La cible est cliquable : le chapô
// explique ET ouvre. Tout est composé de faits déjà connus, jamais inventé.

import Link from 'next/link'

export interface Chapo {
  /** Le verbe de relation, propre au type de fiche : « Découle de », « Produit »… */
  label: string
  /** L'objet cible (titre réel) et sa fiche, quand elle existe. */
  title: string
  href: string | null
}

export function FicheChapo({ chapo }: { chapo: Chapo | null }) {
  if (!chapo) return null
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13.5px]">
      <span className="text-[12.5px] text-muted-foreground">{chapo.label}</span>
      {chapo.href ? (
        <Link href={chapo.href} scroll={false} className="font-medium text-primary hover:underline">
          {chapo.title}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{chapo.title}</span>
      )}
    </div>
  )
}
