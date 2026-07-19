'use client'

// ── MÉMOIRE CAUSALE — coquille (lecture seule) ───────────────────────────────
// Rend les fils causals de getSiteCausalThreads. Présentationnel pur. Trois
// relations, jamais confondues (→ produit · — lié à · ⇢ lien non établi). Chaque
// nœud ouvre sa fiche. On n'affiche que des liens réels — jamais une cause devinée.

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useFicheHref } from '@/components/knowledge/use-fiche-href'
import type { CausalThread, CausalRelation, CausalNodeKind } from '@/lib/knowledge/causal-threads-model'

const NODE_ICON: Record<CausalNodeKind, string> = {
  reunion: '☷', visite: '◱', decision: '⚑', action: '◉', reserve: '▦', cloture: '✓',
}
const NODE_CLS: Record<CausalNodeKind, string> = {
  reunion: 'border-indigo-300 dark:border-indigo-800',
  visite: 'border-emerald-300 dark:border-emerald-800',
  decision: 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20',
  action: 'border-blue-300 dark:border-blue-800',
  reserve: 'border-rose-300 dark:border-rose-800',
  cloture: 'border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/20',
}
const NODE_TXT: Record<CausalNodeKind, string> = {
  reunion: 'text-indigo-600 dark:text-indigo-300',
  visite: 'text-emerald-600 dark:text-emerald-300',
  decision: 'text-emerald-700 dark:text-emerald-300',
  action: 'text-blue-600 dark:text-blue-300',
  reserve: 'text-rose-600 dark:text-rose-300',
  cloture: 'text-emerald-600 dark:text-emerald-300',
}
const REL: Record<CausalRelation, { glyph: string; cls: string; title: string }> = {
  produit: { glyph: '→', cls: 'text-foreground/70', title: 'produit / découle de' },
  lie: { glyph: '—', cls: 'text-muted-foreground/60 text-sm', title: 'lié à / concerne' },
  rupture: { glyph: '⇢', cls: 'text-amber-600 dark:text-amber-400', title: 'lien non établi' },
}

function Node({ node, href }: { node: CausalThread['steps'][number]['node']; href: string | null }) {
  const inner = (
    <span className={cn('flex min-w-[150px] flex-col gap-0.5 rounded-[10px] border px-3 py-2', NODE_CLS[node.kind])}>
      <span className={cn('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide', NODE_TXT[node.kind])}>{NODE_ICON[node.kind]} {node.kind === 'cloture' ? 'Preuve' : node.kind}</span>
      <span className="text-[12.5px] font-semibold leading-tight">{node.label}</span>
      {node.detail && <span className="text-[10.5px] text-muted-foreground">{node.detail}</span>}
    </span>
  )
  return href ? <Link href={href} scroll={false} className="hover:opacity-80">{inner}</Link> : inner
}

export function MemoireCausale({ threads, siteId }: { threads: CausalThread[]; siteId: string }) {
  // Ouvrir un nœud garde l'onglet Mémoire (et son sous-onglet) derrière le panneau.
  const ficheHref = useFicheHref()
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm text-muted-foreground">Comment les faits validés expliquent l’état actuel du chantier.</p>
        {/* Après avoir compris la causalité, on peut consulter le déroulé temporel —
            la Chronologie CANONIQUE, jamais un doublon ici. */}
        <Link href={`/sites/${siteId}?tab=chronologie`} className="text-[12.5px] font-medium text-primary hover:underline">
          Voir la chronologie complète →
        </Link>
      </header>

      {/* Le repère de lecture, compact : les fils sont le cœur, ils passent en
          premier. Le détail des trois questions n'a plus besoin de trois cartes. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border bg-card px-3 py-2 text-[12px]">
        <span className="font-medium text-foreground">Les faits</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium text-foreground">leurs causes validées</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium text-foreground">leurs conséquences.</span>
        <span className="text-muted-foreground/80">Quand un maillon manque, le fil le dit — il n’invente rien.</span>
      </div>

      {threads.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">Aucun fil causal à afficher pour l’instant.</p>
      ) : (
        <div className="space-y-3">
          {threads.map((t) => (
            <div key={t.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-[13.5px] font-semibold">{t.title}</p>
              {t.subtitle && <p className="text-[11.5px] text-muted-foreground">{t.subtitle}</p>}
              <div className="mt-3 flex flex-wrap items-stretch gap-y-2">
                {t.steps.map((step, i) => (
                  <div key={i} className="flex items-stretch">
                    {step.relationFromPrev && (
                      <span className={cn('flex items-center px-2.5 text-lg', REL[step.relationFromPrev].cls)} title={REL[step.relationFromPrev].title}>
                        {REL[step.relationFromPrev].glyph}
                      </span>
                    )}
                    <Node node={step.node} href={ficheHref(step.node.href)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* La légende, repliée par défaut : trois glyphes suffisent à lire, le
          détail s'ouvre pour qui veut comprendre. Plus une doc en bas de page. */}
      <details className="rounded-xl border bg-card px-4 py-3 text-[11.5px] shadow-sm">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-foreground/70"><b>→</b> produit</span>
          <span className="text-muted-foreground"><b>—</b> concerne</span>
          <span className="text-amber-600 dark:text-amber-400"><b>⇢</b> lien non établi</span>
          <span className="ml-auto text-[11px] font-medium text-primary">Comprendre les liens</span>
        </summary>
        <ul className="mt-2.5 grid gap-1.5 border-t pt-2.5 sm:grid-cols-3">
          <li><b className="text-foreground/70">→ produit / découle de</b> : une cause portée par le chantier.</li>
          <li><b className="text-muted-foreground">— lié à / concerne</b> : une relation certaine, sans affirmer de cause.</li>
          <li><b className="text-amber-600 dark:text-amber-400">⇢ lien non établi</b> : le chantier ne relie pas ces deux éléments — jamais présenté comme une cause.</li>
        </ul>
      </details>
    </div>
  )
}
