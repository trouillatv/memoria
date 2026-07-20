'use client'

// ── LA FICHE OBSERVATION — le constat de terrain ─────────────────────────────
// Gabarit canonique, quatrième application : FIL → TITRE → CHAPÔ → sections → sortie.
//
// Le TITRE d'une observation n'est pas un nom d'objet : c'est ce qui a été constaté.
// Quand rien n'a été écrit (photo seule), on ne fabrique pas de titre — on nomme le
// geste et la date. Inventer un titre serait inventer un fait.

import Link from 'next/link'
import { Eye, Paperclip } from 'lucide-react'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FicheTrail, type TrailNode, type TrailBack } from '@/components/knowledge/FicheTrail'
import { FicheChapo, type Chapo } from '@/components/knowledge/FicheChapo'
import { FICHE_TITLE_MOTION, FICHE_BODY_MOTION } from '@/components/knowledge/fiche-motion'
import { cn } from '@/lib/utils'
import type { ObservationFicheData } from '@/lib/knowledge/observation-fiche'

const H4 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'

export function ObservationFicheBody({
  observation,
  back,
  animateContent = false,
  variant = 'panel',
}: {
  observation: ObservationFicheData | null
  back?: TrailBack | null
  animateContent?: boolean
  variant?: 'panel' | 'page'
}) {
  if (!observation) return null
  const o = observation

  // Le fil : la Visite qui la contient, puis l'Observation. La visite est la seule
  // relation garantie par le modèle — le fil existe donc toujours.
  const trail: TrailNode[] = [
    { typeLabel: 'Visite', href: o.visite.href, current: false },
    { typeLabel: 'Observation', href: null, current: true },
  ]

  // Le chapô porte ce qu'elle a PRODUIT — pas la visite, que le fil dit déjà.
  const seul = o.produits.length === 1 ? o.produits[0] : null
  const chapo: Chapo | null = seul
    ? { label: 'A produit', title: seul.typeLabel, href: seul.href }
    : o.produits.length > 1
      ? { label: 'A produit plusieurs objets', title: null, href: null }
      : null

  // Sans texte, le titre nomme le geste : « Photo du 12 juillet 2026 ».
  const titre = o.texte ?? `${o.genreLabel}${o.date ? ` du ${o.date}` : ''}`

  return (
    <>
      {/* 1. LE FAIT */}
      <SheetHeader className="pb-0">
        <FicheTrail nodes={trail} back={back} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            <Eye className="h-3 w-3" /> {o.genreLabel}
          </span>
          {o.date && <span className="text-[11.5px] text-muted-foreground">{o.date}</span>}
          {o.pieceJointe && (
            // Annoncée, jamais simulée : la pièce vit dans la visite.
            <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
              <Paperclip className="h-3 w-3" /> pièce jointe
            </span>
          )}
        </div>
        {variant === 'page'
          ? <h1 className="text-base font-semibold leading-snug">{titre}</h1>
          : <SheetTitle className={cn('text-base font-semibold leading-snug', animateContent && FICHE_TITLE_MOTION)}>{titre}</SheetTitle>}
        <FicheChapo chapo={chapo} className={animateContent ? FICHE_TITLE_MOTION : undefined} />
        <p className={cn('text-[12px] font-medium', o.ecartee ? 'text-muted-foreground' : 'text-foreground')}>
          {o.statutLabel}
        </p>
      </SheetHeader>

      <div className={cn('space-y-5 px-4 pb-6', animateContent && FICHE_BODY_MOTION)}>
        {/* 2. CE QUI A ÉTÉ CONSTATÉ — le texte n'est répété que s'il a servi de titre
             ailleurs ; ici il EST le titre, donc on ne sert que ce qui manque. */}
        {!o.texte && (
          <section>
            <h4 className={H4}>Ce qui a été constaté</h4>
            {o.transcriptionEnCours
              // On DIT que la transcription travaille, plutôt que de laisser un vide
              // qu'on prendrait pour une observation sans contenu.
              ? <p className="mt-1.5 text-[13px] text-muted-foreground">Transcription du vocal en cours.</p>
              : <p className="mt-1.5 text-[13px] text-muted-foreground">Aucun texte saisi — la pièce jointe porte le constat.</p>}
          </section>
        )}

        {/* 3. CE QU'ELLE EST DEVENUE — le chapô nomme le cas unique, on ne le répète pas */}
        {o.produits.length !== 1 && (
          <section>
            <h4 className={H4}>Ce qu&apos;elle est devenue</h4>
            {o.produits.length > 1 ? (
              <ul className="mt-1.5 space-y-1.5">
                {o.produits.map((p) => (
                  <li key={p.id} className="text-[13.5px]">
                    {p.href
                      ? <Link href={p.href} scroll={false} className="font-medium text-primary hover:underline">{p.typeLabel}</Link>
                      : <span className="font-medium">{p.typeLabel}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              // État vide honnête sur sa CAUSE : elle n'a pas encore été triée vers
              // un objet, ce n'est pas qu'elle n'a rien donné.
              <p className="mt-1.5 text-[13px] text-muted-foreground">Pas encore versée vers un objet du chantier.</p>
            )}
          </section>
        )}

        {/* 4. D'OÙ ELLE VIENT — le fil dit qu'il y a une visite ; ici LAQUELLE et QUAND */}
        <section>
          <h4 className={H4}>Relevée pendant</h4>
          <div className="mt-1.5">
            <Link href={o.visite.href} scroll={false} className="text-[13px] font-medium text-foreground hover:underline">
              {o.visite.label}
            </Link>
          </div>
        </section>
      </div>
    </>
  )
}
