'use client'

// Popover composition d'équipe — hover/click sur le badge équipe du briefing
// affiche les membres + le référent. Doctrine V5 : info descriptive uniquement,
// pas de stats individuelles, pas de "score", pas de "performance".

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { UserCircle2, Star } from 'lucide-react'
import { TeamBadge } from '@/components/ui/team-badge'
import { cn } from '@/lib/utils'

interface Props {
  teamName: string
  teamColor: string | null
  memberNames: string[]
  referentName: string | null
}

// Le popover est rendu dans un portail (document.body) avec position: fixed
// pour échapper au overflow-hidden de la Card parente. Sinon la dernière équipe
// du dernier site voit son popover clippé.
const GAP = 6
const POPOVER_W = 224 // min-w 14rem
const POPOVER_MAX_H = 320

export function TeamCompositionPopover({
  teamName,
  teamColor,
  memberNames,
  referentName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'bottom' | 'top' } | null>(
    null,
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  const visible = open || hovered
  const hasInfo = memberNames.length > 0 || referentName

  // Position : flip vers le haut si pas la place en bas.
  useLayoutEffect(() => {
    if (!visible || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const placement: 'bottom' | 'top' =
      spaceBelow < POPOVER_MAX_H + GAP && rect.top > spaceBelow ? 'top' : 'bottom'
    const top = placement === 'bottom' ? rect.bottom + GAP : rect.top - GAP
    let left = rect.left
    // Clamp horizontal pour rester dans le viewport.
    const maxLeft = window.innerWidth - POPOVER_W - 8
    if (left > maxLeft) left = Math.max(8, maxLeft)
    if (left < 8) left = 8
    setPos({ top, left, placement })
  }, [visible])

  // Click extérieur ferme.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(t) &&
        panelRef.current && !panelRef.current.contains(t)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Reposition au scroll / resize tant que visible.
  useEffect(() => {
    if (!visible) return
    function reposition() {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const placement: 'bottom' | 'top' =
        spaceBelow < POPOVER_MAX_H + GAP && rect.top > spaceBelow ? 'top' : 'bottom'
      const top = placement === 'bottom' ? rect.bottom + GAP : rect.top - GAP
      let left = rect.left
      const maxLeft = window.innerWidth - POPOVER_W - 8
      if (left > maxLeft) left = Math.max(8, maxLeft)
      if (left < 8) left = 8
      setPos({ top, left, placement })
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [visible])

  const panel = visible && hasInfo && pos && mounted ? (
    <div
      ref={panelRef}
      role="dialog"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        transform: pos.placement === 'top' ? 'translateY(-100%)' : undefined,
        minWidth: POPOVER_W,
        maxWidth: 288,
        maxHeight: POPOVER_MAX_H,
        overflowY: 'auto',
      }}
      className={cn(
        'z-50 rounded-lg border bg-card shadow-lg ring-1 ring-black/5',
        'p-3 text-xs animate-in fade-in-0 zoom-in-95 duration-100',
      )}
    >
      <div className="flex items-center gap-2 pb-2 border-b">
        <TeamBadge name={teamName} color={teamColor} size="sm" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {memberNames.length} membre{memberNames.length > 1 ? 's' : ''}
        </span>
      </div>

      {referentName && (
        <div className="flex items-center gap-1.5 mt-2 text-foreground">
          <Star className="h-3 w-3 text-brand-600 fill-brand-600/40" aria-hidden />
          <span className="font-medium">{referentName}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Référent
          </span>
        </div>
      )}

      {memberNames.length > 0 && (
        <ul className="mt-2 space-y-1">
          {memberNames.map((n) => (
            <li
              key={n}
              className={cn(
                'flex items-center gap-1.5',
                n === referentName ? 'hidden' : 'text-muted-foreground',
              )}
            >
              <UserCircle2 className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}

      {memberNames.length === 0 && !referentName && (
        <p className="italic text-muted-foreground mt-1">
          Composition non renseignée.
        </p>
      )}
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => hasInfo && setOpen((o) => !o)}
        onMouseEnter={() => hasInfo && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          'inline-flex transition-transform',
          hasInfo && 'cursor-pointer hover:scale-[1.02]',
          !hasInfo && 'cursor-default',
        )}
        aria-expanded={visible}
        aria-label={`Composition de l'équipe ${teamName}`}
      >
        <TeamBadge name={teamName} color={teamColor} size="sm" />
      </button>
      {mounted && panel && createPortal(panel, document.body)}
    </>
  )
}
