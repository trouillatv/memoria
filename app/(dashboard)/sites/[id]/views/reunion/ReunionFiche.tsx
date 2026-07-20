'use client'

// ── LA FICHE RÉUNION — tête de la chaîne (Réunion › Décision › Action) ────────
// Gabarit canonique, sans exception : FIL → TITRE → CHAPÔ → sections → sortie.
// Aucune règle nouvelle n'a été inventée pour cet objet ; c'est le but du Lot 4.
//
// Relation d'identité (6ᵉ règle) : la Réunion CONDUIT À une décision. Une seule
// nommée → on la nomme et on l'ouvre ; plusieurs → énoncé sans objet ni compte
// (précédent de la fiche Intervenant : ni élire, ni compter) ; aucune → pas de
// chapô, la réunion existe sans avoir rien produit et le corps le dit.

import Link from 'next/link'
import { ArrowUpRight, Users } from 'lucide-react'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FicheTrail, type TrailNode, type TrailBack } from '@/components/knowledge/FicheTrail'
import { FicheChapo, type Chapo } from '@/components/knowledge/FicheChapo'
import { FICHE_TITLE_MOTION, FICHE_BODY_MOTION } from '@/components/knowledge/fiche-motion'
import { cn } from '@/lib/utils'
import type { ReunionFicheData } from '@/lib/knowledge/reunion-fiche'

const H4 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'

/** Ce que le mot désigne, quand ce n'est pas une personne. */
const KIND_HINT: Record<string, string | null> = {
  person: null,
  company: 'entreprise',
  control: 'contrôle',
  other: null,
}

export function ReunionFicheBody({
  reunion,
  back,
  animateContent = false,
  variant = 'panel',
}: {
  reunion: ReunionFicheData | null
  back?: TrailBack | null
  animateContent?: boolean
  variant?: 'panel' | 'page'
}) {
  if (!reunion) return null
  const r = reunion

  // Le fil : la Réunion est la TÊTE, le point est donc sur le premier maillon.
  // Le maillon Décision n'est cliquable que s'il n'y en a qu'une : avec plusieurs,
  // le fil ne saurait pas laquelle ouvrir, et choisir serait inventer.
  const seule = r.decisions.length === 1 ? r.decisions[0] : null
  const trail: TrailNode[] = [
    { typeLabel: r.kindLabel, href: null, current: true },
    ...(r.decisions.length > 0 ? [{ typeLabel: 'Décision', href: seule?.href ?? null, current: false }] : []),
  ]

  const chapo: Chapo | null = seule
    ? { label: 'Conduit à', title: seule.titre, href: seule.href }
    : r.decisions.length > 1
      ? { label: 'Conduit à plusieurs décisions', title: null, href: null }
      : null

  return (
    <>
      {/* 1. LE FAIT */}
      <SheetHeader className="pb-0">
        <FicheTrail nodes={trail} back={back} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
            ◷ {r.kindLabel}
          </span>
          {r.date && <span className="text-[11.5px] text-muted-foreground">{r.date}</span>}
        </div>
        {variant === 'page'
          ? <h1 className="text-base font-semibold leading-snug">{r.titre}</h1>
          : <SheetTitle className={cn('text-base font-semibold leading-snug', animateContent && FICHE_TITLE_MOTION)}>{r.titre}</SheetTitle>}
        <FicheChapo chapo={chapo} className={animateContent ? FICHE_TITLE_MOTION : undefined} />
      </SheetHeader>

      <div className={cn('space-y-5 px-4 pb-6', animateContent && FICHE_BODY_MOTION)}>
        {/* 2. CE QU'ELLE A PRODUIT — la raison d'être de la fiche */}
        <section>
          <h4 className={H4}>Ce qu&apos;elle a produit</h4>
          {r.decisions.length > 0 ? (
            <ul className="mt-1.5 space-y-1.5">
              {r.decisions.map((d) => (
                <li key={d.id}>
                  <Link href={d.href} scroll={false} className="text-[13.5px] font-medium text-primary hover:underline">
                    {d.titre}
                  </Link>
                  <span className="ml-1.5 text-[11.5px] text-muted-foreground">{d.statutLabel}</span>
                </li>
              ))}
            </ul>
          ) : (
            // État vide EXPLICITE : une réunion sans décision le DIT. On ne laisse
            // jamais croire qu'une donnée manque à l'affichage.
            <p className="mt-1.5 text-[13px] text-muted-foreground">Aucune décision enregistrée pour cette {r.kindLabel.toLowerCase()}.</p>
          )}
        </section>

        {/* 3. QUI ÉTAIT LÀ — descriptif, jamais un contrôle de présence */}
        <section>
          <h4 className={H4}>Présents</h4>
          {r.participants.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {r.participants.map((p, i) => {
                const hint = KIND_HINT[p.kind]
                return (
                  <li key={`${p.name}-${i}`} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 text-[12px]">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{p.name}</span>
                    {(p.role || hint) && <span className="text-muted-foreground">· {p.role ?? hint}</span>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-1.5 text-[13px] text-muted-foreground">Présents non renseignés.</p>
          )}
        </section>

        {/* 4. LA SORTIE — l'espace de travail du compte-rendu.
             Nommée comme une sortie, en bas, jamais comme la destination de la
             fiche : le conteneur est un contexte, pas un écran de substitution. */}
        <section className="border-t pt-4">
          <Link
            href={r.compteRenduHref}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Ouvrir le compte-rendu complet
            <ArrowUpRight className="h-3.5 w-3.5" />
            {r.compteRenduStatutLabel && (
              <span className="text-[11.5px] font-normal text-muted-foreground">· {r.compteRenduStatutLabel}</span>
            )}
          </Link>
        </section>
      </div>
    </>
  )
}
