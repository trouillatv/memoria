// Primitives d'affichage PARTAGÉES par les fiches acteurs (Personne, Entreprise,
// et Équipe demain). Structure visuelle commune, contrats métier distincts. Purement
// présentationnel (aucun hook) → utilisable dans un Server Component.

import Link from 'next/link'
import { ArrowRight, AlertTriangle } from 'lucide-react'
import { attentionLevelLabel, type AttentionLevel } from '@/lib/knowledge/actor-attention'
import { companyFill } from './graph/actor-colors'

/** Avatar entreprise — initiale + couleur stable par companyId (même palette
 *  que le graphe acteurs, cf. actor-colors.ts) : une entreprise garde la même
 *  couleur partout dans l'app. Recette visuelle Vincent 2026-09-15 (maquettes
 *  desktop + mobile) : remplace l'icône bâtiment générique. */
export function CompanyAvatar({ name, companyId, size = 'md' }: { name: string; companyId: string; size?: 'sm' | 'md' }) {
  const letter = name.trim().charAt(0).toUpperCase() || '?'
  const dim = size === 'sm' ? 'h-8 w-8 text-[12px]' : 'h-9 w-9 text-[13px]'
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${dim}`}
      style={{ backgroundColor: companyFill(companyId) }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

/** Pastille d'état — décrit la situation opérationnelle, ne juge jamais l'acteur.
 *  « À jour » reste DISCRET (contour gris) : la couleur forte est réservée aux
 *  problèmes (orange/rouge) pour que l'œil aille droit à ce qui compte. */
export function AttentionBadge({ level }: { level: AttentionLevel }) {
  if (level === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {attentionLevelLabel(level)}
      </span>
    )
  }
  const cls = level === 'urgent'
    ? 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300'
    : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      <AlertTriangle className="h-3 w-3" aria-hidden /> {attentionLevelLabel(level)}
    </span>
  )
}

export function FicheSection({ title, count, icon, tint, children }: {
  title: string
  count?: number
  /** Icône de section (lucide, déjà dimensionnée par l'appelant) — optionnelle,
   *  n'affecte pas les fiches qui ne la fournissent pas encore. */
  icon?: React.ReactNode
  tint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground/90">
        {icon && (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={tint ? { background: `${tint}1a`, color: tint } : undefined}>
            {icon}
          </span>
        )}
        <span>
          {title}
          {typeof count === 'number' && count > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
        </span>
      </h2>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function rowInner(icon: React.ReactNode, label: string, sub: React.ReactNode, trailing?: React.ReactNode) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{label}</div>
        {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {trailing}
    </div>
  )
}

export function FicheRow({ icon, label, sub, trailing }: { icon: React.ReactNode; label: string; sub?: React.ReactNode; trailing?: React.ReactNode }) {
  return <div className="rounded-lg px-1.5 py-1.5">{rowInner(icon, label, sub, trailing)}</div>
}

export function FicheLinkRow({ href, icon, label, sub, trailing }: { href: string; icon: React.ReactNode; label: string; sub?: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <Link href={href} className="group block rounded-lg px-1.5 py-1.5 transition-colors hover:bg-brand-50/40 dark:hover:bg-brand-600/5">
      {rowInner(icon, label, sub, trailing ?? <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-foreground" aria-hidden />)}
    </Link>
  )
}

export function FicheEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1 text-xs italic text-muted-foreground">{children}</p>
}
