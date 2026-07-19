'use client'

// ── MÉMOIRE CAUSALE — coquille (lecture seule) ───────────────────────────────
// Rend les fils causals de getSiteCausalThreads. Présentationnel pur. Trois
// relations, jamais confondues (→ produit · — lié à · ⇢ lien non établi). Chaque
// nœud ouvre sa fiche. On n'affiche que des liens réels — jamais une cause devinée.

import Link from 'next/link'
import { cn } from '@/lib/utils'
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

function Node({ node }: { node: CausalThread['steps'][number]['node'] }) {
  const inner = (
    <span className={cn('flex min-w-[150px] flex-col gap-0.5 rounded-[10px] border px-3 py-2', NODE_CLS[node.kind])}>
      <span className={cn('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide', NODE_TXT[node.kind])}>{NODE_ICON[node.kind]} {node.kind === 'cloture' ? 'Preuve' : node.kind}</span>
      <span className="text-[12.5px] font-semibold leading-tight">{node.label}</span>
      {node.detail && <span className="text-[10.5px] text-muted-foreground">{node.detail}</span>}
    </span>
  )
  return node.href ? <Link href={node.href} scroll={false} className="hover:opacity-80">{inner}</Link> : inner
}

export function MemoireCausale({ threads, siteId }: { threads: CausalThread[]; siteId: string }) {
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

      <div className="grid gap-3 sm:grid-cols-3">
        {[['Que se passe-t-il ?', 'Les faits datés : réunions, décisions, réserves.'],
          ['Pourquoi cet état existe-t-il ?', 'La chaîne de causes, suivie par les liens réels — jamais devinée.'],
          ['Qu’est-ce qui a changé ensuite ?', 'Les conséquences : actions produites, réserves levées, clôtures.']].map(([q, s]) => (
          <div key={q} className="rounded-xl border bg-card p-3.5 shadow-sm">
            <p className="text-[12.5px] font-semibold">{q}</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{s}</p>
          </div>
        ))}
      </div>
      <p className="-mt-1 text-[11.5px] text-muted-foreground/80">Chaque fil répond à ce qu’il sait. Quand un maillon manque, il le dit — il n’invente rien.</p>

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
                    <Node node={step.node} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border bg-card p-4 text-[11.5px] shadow-sm">
        <p className="mb-2 text-[13px] font-semibold">Trois façons de relier — jamais confondues</p>
        <ul className="grid gap-1.5 sm:grid-cols-3">
          <li><b className="text-foreground/70">→ produit / découle de</b> : une cause portée par le chantier.</li>
          <li><b className="text-muted-foreground">— lié à / concerne</b> : une relation certaine, sans affirmer de cause.</li>
          <li><b className="text-amber-600 dark:text-amber-400">⇢ lien non établi</b> : le chantier ne relie pas ces deux éléments — jamais présenté comme une cause.</li>
        </ul>
      </div>
    </div>
  )
}
