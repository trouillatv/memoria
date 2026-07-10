'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

/**
 * « Terminé aujourd'hui » — replié PAR DÉFAUT. Le fait est la chose la moins
 * urgente : il ne doit pas pousser l'important vers le bas. On l'annonce d'une
 * ligne (le compte rassure : « c'est fait »), on le déplie à la demande.
 *
 * TRANSITION « Maintenant → Fait » : quand un événement a REJOINT le Fait
 * depuis le dernier passage sur le Journal (même session), l'écran le raconte
 * au lieu de le faire disparaître en silence — la section s'ouvre seule, la
 * ligne fraîche arrive en respirant, puis tout se replie (chorégraphie : « ce
 * qui a servi disparaît »). Détection par comparaison d'ids en sessionStorage :
 * zéro requête, zéro état serveur — un calcul d'affichage, pas une entité.
 *
 * Le contenu (rows compactes) est rendu côté serveur et passé en `children` :
 * ce composant ne fait que le rythme d'apparition.
 */

interface DoneItem {
  id: string
  title: string
}

const STORE_KEY = 'memoria-journal-fait'

export function DoneToday({
  count,
  items = [],
  children,
}: {
  count: number
  items?: DoneItem[]
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [justDone, setJustDone] = useState<DoneItem[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  // Si l'utilisateur a touché la section, la chorégraphie ne la replie pas.
  const userToggledRef = useRef(false)

  useEffect(() => {
    let stored: { day: string; ids: string[] } | null = null
    try {
      stored = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null')
    } catch { /* stockage indisponible → pas de transition, jamais d'erreur */ }
    const day = new Date().toDateString()
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ day, ids: items.map((i) => i.id) }))
    } catch { /* idem */ }
    // Premier passage du jour : rien à raconter (sinon tout « arriverait »).
    if (!stored || stored.day !== day) return
    const known = new Set(stored.ids)
    const fresh = items.filter((i) => !known.has(i.id))
    if (fresh.length === 0) return

    setJustDone(fresh)
    setOpen(true)
    const fold = setTimeout(() => {
      setJustDone([])
      if (!userToggledRef.current) setOpen(false)
    }, 6000)
    return () => clearTimeout(fold)
    // Comparaison au montage uniquement : la liste du jour ne bouge pas pendant l'affichage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Surligne les lignes fraîches (rendues côté serveur, repérées par data-done-id).
  useEffect(() => {
    if (!open || justDone.length === 0) return
    const fresh = new Set(justDone.map((i) => i.id))
    rootRef.current?.querySelectorAll<HTMLElement>('[data-done-id]').forEach((el) => {
      if (fresh.has(el.dataset.doneId ?? '')) el.classList.add('done-fresh')
    })
  }, [open, justDone])

  return (
    <div ref={rootRef} className="space-y-2">
      <style>{`
        @keyframes doneArrive { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: none; } }
        @keyframes doneGlow { from { background-color: rgb(16 185 129 / 0.16); } to { background-color: transparent; } }
        .done-announce { animation: doneArrive .45s cubic-bezier(.2,.7,.3,1) both; }
        .done-fresh { border-radius: 10px; animation: doneArrive .45s cubic-bezier(.2,.7,.3,1) both, doneGlow 3s ease-out .45s both; }
        @media (prefers-reduced-motion: reduce) {
          .done-announce, .done-fresh { animation: none; }
        }
      `}</style>

      <button
        type="button"
        onClick={() => { userToggledRef.current = true; setOpen((v) => !v) }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 pt-1 text-left"
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Terminé aujourd&apos;hui ({count})
        </span>
        <span className="h-px flex-1 rounded bg-foreground/[0.06]" />
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {justDone.length > 0 && (
        <p className="done-announce flex items-center gap-1.5 pl-6 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="h-3 w-3" strokeWidth={3} />
          {justDone.map((i) => i.title).join(' · ')} — à l&apos;instant
        </p>
      )}

      {open && children}
    </div>
  )
}
