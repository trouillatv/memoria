'use client'

// ── LE CHAPÔ — « pourquoi cet objet compte » ─────────────────────────────────
// Une ÉTIQUETTE sous le titre, pas une phrase : le cerveau lit « Découle de : X »
// plus vite qu'une tournure complète. UNE seule relation centrale par fiche —
// jamais un inventaire (règle Vincent) : l'objet dit son RÔLE dans la chaîne, pas
// son bilan. Le libellé de relation vient du TYPE de fiche (Action → « Découle de »,
// Décision → « Produit »…), la cible est l'objet le plus significatif.
//
// La cible est cliquable : le chapô explique ET ouvre — une porte de plus, jamais
// un texte mort. Tout est composé de faits déjà connus, jamais inventé.

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
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
        {chapo.label}
      </span>
      {chapo.href ? (
        <Link href={chapo.href} scroll={false} className="font-medium text-foreground hover:underline">
          {chapo.title}
        </Link>
      ) : (
        <span className="font-medium text-foreground">{chapo.title}</span>
      )}
    </div>
  )
}
