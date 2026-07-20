'use client'

// ── LA FICHE RÉSERVE — le défaut qui doit être levé ──────────────────────────
// Gabarit canonique : FIL → TITRE → CHAPÔ → sections → sortie.
//
// Relation d'identité : « Corrigée par » — l'action qui traite la réserve.
// Règle des trois cas, inchangée : une action nommée · plusieurs sans compte ni
// élection · aucune, pas de chapô.
//
// Vocabulaire : une réserve se LÈVE. Jamais « résolue », jamais « fermée ».

import Link from 'next/link'
import { AlertTriangle, Camera } from 'lucide-react'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FicheTrail, type TrailNode, type TrailBack } from '@/components/knowledge/FicheTrail'
import { FicheChapo, type Chapo } from '@/components/knowledge/FicheChapo'
import { FICHE_TITLE_MOTION, FICHE_BODY_MOTION } from '@/components/knowledge/fiche-motion'
import { cn } from '@/lib/utils'
import type { ReserveFicheData } from '@/lib/knowledge/reserve-fiche'

const H4 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'

export function ReserveFicheBody({
  reserve,
  back,
  animateContent = false,
  variant = 'panel',
}: {
  reserve: ReserveFicheData | null
  back?: TrailBack | null
  animateContent?: boolean
  variant?: 'panel' | 'page'
}) {
  if (!reserve) return null
  const r = reserve

  // Le fil : la Réserve, puis l'Action qui la corrige. Le Sujet n'est pas un
  // maillon de la chaîne causale — il la traverse — donc il vit dans le corps.
  const seule = r.actions.length === 1 ? r.actions[0] : null
  const trail: TrailNode[] = [
    { typeLabel: 'Réserve', href: null, current: true },
    ...(r.actions.length > 0 ? [{ typeLabel: 'Action', href: seule?.href ?? null, current: false }] : []),
  ]

  const chapo: Chapo | null = seule
    ? { label: 'Corrigée par', title: seule.titre, href: seule.href }
    : r.actions.length > 1
      ? { label: 'Corrigée par plusieurs actions', title: null, href: null }
      : null

  const photo = r.photoAvant || r.photoApres

  return (
    <>
      {/* 1. LE FAIT */}
      <SheetHeader className="pb-0">
        <FicheTrail nodes={trail} back={back} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Réserve
          </span>
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
              r.levee
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900'
                : 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
            )}
          >
            {r.statutLabel}
          </span>
          {r.lieu && <span className="text-[11.5px] text-muted-foreground">{r.lieu}</span>}
        </div>
        {variant === 'page'
          ? <h1 className="text-base font-semibold leading-snug">{r.label}</h1>
          : <SheetTitle className={cn('text-base font-semibold leading-snug', animateContent && FICHE_TITLE_MOTION)}>{r.label}</SheetTitle>}
        <FicheChapo chapo={chapo} className={animateContent ? FICHE_TITLE_MOTION : undefined} />
      </SheetHeader>

      <div className={cn('space-y-5 px-4 pb-6', animateContent && FICHE_BODY_MOTION)}>
        {/* 2. OÙ ELLE EN EST — le fait contractuel avant tout le reste */}
        <section>
          <h4 className={H4}>Où elle en est</h4>
          {r.levee ? (
            <>
              <p className="mt-1.5 text-[13.5px] font-medium text-emerald-700 dark:text-emerald-400">
                ● Levée{r.leveeLe ? ` le ${r.leveeLe}` : ''}
              </p>
              {r.noteLevee
                // La note de levée est reprise TELLE QUELLE : c'est la trace de ce
                // qui a été fait, pas un résumé à réécrire.
                ? <p className="mt-1.5 text-[14px] leading-relaxed">{r.noteLevee}</p>
                : <p className="mt-1.5 text-[13px] text-muted-foreground">Aucune note de levée enregistrée.</p>}
            </>
          ) : (
            <p className="mt-1.5 text-[13.5px] font-medium text-amber-800 dark:text-amber-300">Ouverte — elle reste à lever.</p>
          )}
        </section>

        {/* 3. QUI L'A ÉMISE — une réserve vient toujours de quelqu'un */}
        <section>
          <h4 className={H4}>Émise par</h4>
          {r.emisePar || r.emiseLe ? (
            <p className="mt-1 text-[13.5px]">
              {r.emisePar ?? 'Émetteur non renseigné'}
              {r.emiseLe && <span className="text-muted-foreground"> · {r.emiseLe}</span>}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">Émetteur non renseigné.</p>
          )}
        </section>

        {/* 4. CE QUI LA CORRIGE — le chapô nomme l'action quand il n'y en a qu'une ;
             ici on ne répète pas ce cas, on ne sert que ce qu'il ne dit pas. */}
        {r.actions.length !== 1 && (
          <section>
            <h4 className={H4}>Ce qui la corrige</h4>
            {r.actions.length > 1 ? (
              <ul className="mt-1.5 space-y-1.5">
                {r.actions.map((a) => (
                  <li key={a.id}>
                    <Link href={a.href} scroll={false} className="text-[13.5px] font-medium text-primary hover:underline">{a.titre}</Link>
                    <span className="ml-1.5 text-[11.5px] text-muted-foreground">{a.statusLabel}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[13px] text-muted-foreground">Aucune action rattachée à cette réserve.</p>
            )}
          </section>
        )}

        {/* 5. CE QU'ELLE TOUCHE — le sujet TRAVERSE la chaîne, il n'en est pas un maillon */}
        {r.sujet && (
          <section>
            <h4 className={H4}>Sujet suivi</h4>
            <Link href={r.sujet.href} scroll={false} className="mt-1 inline-block text-[13.5px] font-medium text-primary hover:underline">
              {r.sujet.nom}
            </Link>
          </section>
        )}

        {/* 6. LA PREUVE — on DIT qu'elle existe, on ne l'affiche pas ici : les photos
             demandent une URL signée et vivent dans l'écran des réserves. */}
        {photo && (
          <section>
            <h4 className={H4}>Preuve photo</h4>
            <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Camera className="h-3.5 w-3.5" />
              {r.photoAvant && r.photoApres ? 'Constat et levée' : r.photoAvant ? 'Constat' : 'Levée'}
              {' '}— à voir dans les réserves du chantier
            </p>
          </section>
        )}

        {/* 7. LA SORTIE */}
        <section className="border-t pt-4">
          <Link
            href={r.gestionHref}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Voir dans les réserves du chantier →
          </Link>
        </section>
      </div>
    </>
  )
}
