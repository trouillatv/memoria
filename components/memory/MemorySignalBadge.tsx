'use client'

// Badge / ligne « mémoire du lieu » pour le planning (Planning-1, Vincent 2026-05-22).
//
// Sujet = le SITE, jamais une personne. Aucune métrique RH, aucune charge/perf.
// Le texte vient du renderer (pur), la couleur de la famille du signal. Wording
// non-impératif garanti par le renderer.

import type { MemorySignal } from '@/lib/memory/signals/types'
import { SIGNAL_REGISTRY, type SignalFamily } from '@/lib/memory/signals/registry'
import { renderSignal } from '@/lib/memory/signals/render'

// Teintes discrètes par famille (alignées sur le dashboard).
const FAMILY_BADGE: Record<SignalFamily, string> = {
  attention: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300',
  continuite: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300',
  ao: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-900/40 dark:bg-violet-950/30 dark:text-violet-300',
  memoire: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-300',
}

const FAMILY_DOT: Record<SignalFamily, string> = {
  attention: 'text-red-600',
  continuite: 'text-amber-600',
  ao: 'text-violet-600',
  memoire: 'text-sky-600',
}

/** Badge unique sur l'en-tête de ligne site (1 par site = signal prioritaire). */
export function MemorySignalBadge({ signal }: { signal: MemorySignal }) {
  const meta = SIGNAL_REGISTRY[signal.kind]
  const r = renderSignal(signal)
  const tip = r.detail ? `${r.text} — ${r.detail}` : r.text
  return (
    <span
      data-signal-kind={signal.kind}
      title={tip}
      className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${FAMILY_BADGE[meta.family]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {meta.label}
    </span>
  )
}

/** Ligne détaillée pour le drawer (« mémoire du lieu »). */
export function MemorySignalLine({ signal }: { signal: MemorySignal }) {
  const meta = SIGNAL_REGISTRY[signal.kind]
  const r = renderSignal(signal)
  return (
    <li className="flex items-start gap-2 text-xs" data-signal-kind={signal.kind}>
      <span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${FAMILY_DOT[meta.family]}`} />
      <span className="leading-snug">
        {r.text}
        {r.detail && <span className="text-muted-foreground"> — {r.detail}</span>}
      </span>
    </li>
  )
}
