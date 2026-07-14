'use client'

// Popover mémoire des lieux — hover/click sur le nom d'un site du briefing
// affiche les notes récentes (code d'entrée, accès…). Doctrine V5 : info
// descriptive uniquement, format passif, jamais injonctif.
// Pattern identique à TeamCompositionPopover (portail + flip).

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Info, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SiteFieldsDisplay,
  hasAnySiteField,
} from '@/app/(dashboard)/sites/SiteFieldsDisplay'

interface Note {
  body: string
  created_at: string
}

interface SiteFields {
  address: string | null
  access_code: string | null
  alarm_code: string | null
  contact_name: string | null
  contact_phone: string | null
  access_hours: string | null
  access_instructions: string | null
}

interface Props {
  siteName: string
  notes: Note[]
  fields: SiteFields
}

const GAP = 6
const POPOVER_W = 280
const POPOVER_MAX_H = 320

function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

export function SiteNotesPopover({ siteName, notes, fields }: Props) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'bottom' | 'top' } | null>(
    null,
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  const hasNotes = notes.length > 0
  const hasFields = hasAnySiteField(fields)
  const hasContent = hasNotes || hasFields
  const visible = (open || hovered) && hasContent

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current) return
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
  }, [visible])

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

  const panel = visible && pos && mounted ? (
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
        maxWidth: 360,
        maxHeight: POPOVER_MAX_H,
        overflowY: 'auto',
      }}
      className={cn(
        'z-50 rounded-lg border bg-card shadow-lg ring-1 ring-black/5',
        'p-3 text-xs animate-in fade-in-0 zoom-in-95 duration-100',
      )}
    >
      <div className="flex items-center gap-2 pb-2 border-b">
        <MessageSquare className="h-3 w-3 text-muted-foreground" aria-hidden />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Fiche chantier · {siteName}
        </span>
      </div>
      {hasFields && (
        <div className="mt-2">
          <SiteFieldsDisplay site={fields} variant="compact" />
        </div>
      )}
      {hasNotes && (
        <div className={hasFields ? 'mt-2 pt-2 border-t' : 'mt-2'}>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
            Mémoire ({notes.length})
          </div>
          <ul className="space-y-1.5">
            {notes.map((n, i) => (
              <li key={`${n.created_at}-${i}`} className="flex items-baseline gap-2">
                <span className="text-muted-foreground tabular-nums shrink-0 text-[10px]">
                  {formatDate(n.created_at)}
                </span>
                <span className="whitespace-pre-wrap text-foreground/90">{n.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => hasContent && setOpen((o) => !o)}
        onMouseEnter={() => hasContent && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          'inline-flex items-center gap-1.5 font-medium transition-colors',
          hasContent && 'cursor-pointer hover:text-brand-700',
          !hasContent && 'cursor-default',
        )}
        aria-expanded={visible}
        aria-label={hasContent ? `Fiche site pour ${siteName}` : siteName}
      >
        {siteName}
        {hasContent && (
          // Chip "fiche" visible sur mobile (pas hover-only). Bordure + pastille
          // si notes datées présentes pour signaler "il y a de l'info récente".
          <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-normal text-brand-700 uppercase tracking-wider">
            <Info className="h-2.5 w-2.5" aria-hidden />
            fiche
            {notes.length > 0 && (
              <span
                className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-brand-600 text-white text-[9px] font-semibold tabular-nums px-1"
                aria-label={`${notes.length} note${notes.length > 1 ? 's' : ''} de mémoire`}
              >
                {notes.length}
              </span>
            )}
          </span>
        )}
      </button>
      {mounted && panel && createPortal(panel, document.body)}
    </>
  )
}
