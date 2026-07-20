'use client'

// ── LA FICHE DOCUMENT — la preuve dans le graphe ─────────────────────────────
// Gabarit canonique, sans exception : FIL → TITRE → CHAPÔ → sections → sortie.
//
// Relation d'identité (6ᵉ règle), convention déjà fixée : Document → « Justifie ».
// Une seule réserve prouvée → elle est nommée ; plusieurs → énoncé sans compte ni
// élection (précédent Intervenant, puis Réunion) ; aucune → pas de chapô. Le
// document existe alors comme pièce du dossier, et le corps le dit.
//
// Ce que la fiche ne fait PAS : afficher le fichier. Le contenu, l'URL signée et
// le journal d'accès vivent dans la visionneuse — sortie nommée en bas.

import Link from 'next/link'
import { ArrowUpRight, FileText } from 'lucide-react'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FicheTrail, type TrailNode, type TrailBack } from '@/components/knowledge/FicheTrail'
import { FicheChapo, type Chapo } from '@/components/knowledge/FicheChapo'
import { FICHE_TITLE_MOTION, FICHE_BODY_MOTION } from '@/components/knowledge/fiche-motion'
import { cn } from '@/lib/utils'
import type { DocumentFicheData } from '@/lib/knowledge/document-fiche'

const H4 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'

export function DocumentFicheBody({
  document,
  back,
  animateContent = false,
  variant = 'panel',
}: {
  document: DocumentFicheData | null
  back?: TrailBack | null
  animateContent?: boolean
  variant?: 'panel' | 'page'
}) {
  if (!document) return null
  const d = document

  // Le fil : la Réunion qui l'a produit, puis le Document (courant). Sans réunion
  // source, le document n'est pas dans la chaîne causale — il n'y a pas de fil, et
  // on n'en fabrique pas un.
  const trail: TrailNode[] = [
    ...(d.reunion ? [{ typeLabel: 'Réunion', href: d.reunion.href, current: false }] : []),
    { typeLabel: 'Document', href: null, current: true },
  ]

  const seule = d.reserves.length === 1 ? d.reserves[0] : null
  const chapo: Chapo | null = seule
    ? { label: 'Justifie', title: seule.label, href: `/sites/${d.siteId}/reserves` }
    : d.reserves.length > 1
      ? { label: 'Justifie plusieurs réserves', title: null, href: null }
      : null

  return (
    <>
      {/* 1. LE FAIT */}
      <SheetHeader className="pb-0">
        <FicheTrail nodes={trail} back={back} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            <FileText className="h-3 w-3" /> {d.typeLabel}
          </span>
          {d.dateLabel && (
            // On DIT laquelle : une date d'effet et une date de dépôt ne se valent
            // pas, et les confondre ferait mentir le document.
            <span className="text-[11.5px] text-muted-foreground">
              {d.dateIsEffective ? 'En vigueur au' : 'Déposé le'} {d.dateLabel}
            </span>
          )}
        </div>
        {variant === 'page'
          ? <h1 className="text-base font-semibold leading-snug break-words">{d.filename}</h1>
          : <SheetTitle className={cn('text-base font-semibold leading-snug break-words', animateContent && FICHE_TITLE_MOTION)}>{d.filename}</SheetTitle>}
        <FicheChapo chapo={chapo} className={animateContent ? FICHE_TITLE_MOTION : undefined} />
      </SheetHeader>

      <div className={cn('space-y-5 px-4 pb-6', animateContent && FICHE_BODY_MOTION)}>
        {/* 2. CE QU'IL PROUVE */}
        <section>
          <h4 className={H4}>Ce qu&apos;il prouve</h4>
          {d.reserves.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {d.reserves.map((r) => (
                <li key={r.id} className="text-[13.5px]">{r.label}</li>
              ))}
            </ul>
          ) : (
            // État vide EXPLICITE, et honnête sur sa cause : ce n'est pas « aucune
            // preuve », c'est « aucun lien enregistré ».
            <p className="mt-1.5 text-[13px] text-muted-foreground">Aucune réserve rattachée à ce document.</p>
          )}
        </section>

        {/* 3. D'OÙ IL VIENT — le fil dit qu'il y a une réunion ; ici on donne ce
             qu'il ne porte pas : LAQUELLE et QUAND. Une ligne, jamais une carte. */}
        <section>
          <h4 className={H4}>D&apos;où il vient</h4>
          {d.reunion ? (
            <div className="mt-1.5">
              <p className="text-[11.5px] text-muted-foreground">Produit lors de</p>
              <Link href={d.reunion.href} scroll={false} className="text-[13px] font-medium text-foreground hover:underline">
                {d.reunion.label}
              </Link>
            </div>
          ) : (
            <p className="mt-1.5 text-[13px] text-muted-foreground">Déposé directement sur le chantier, sans réunion source.</p>
          )}
        </section>

        {/* 4. LA SORTIE — la visionneuse porte le fichier, l'URL signée et l'audit. */}
        <section className="border-t pt-4">
          <Link
            href={d.visionneuseHref}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Ouvrir le document
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      </div>
    </>
  )
}
