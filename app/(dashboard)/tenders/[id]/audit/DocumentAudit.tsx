'use client'

// Niveau 2 — Audit documentaire (Vincent 2026-06-22). PDF du dossier + liste
// NAVIGABLE de tous les engagements. Le PDF saute à la page de l'engagement courant
// (#page=N ; remontage de l'iframe au changement de page pour que le saut soit fiable).
// Pas de surlignage au pixel (on n'a pas les coordonnées). Glissière gauche/droite.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, ExternalLink } from 'lucide-react'
import { KIND_META } from '@/lib/engagements/kind'
import { citationLevel } from '@/lib/engagements/citation'
import type { EngagementKind } from '@/types/db'

export interface AuditEngagement {
  id: string
  kind: EngagementKind | null
  shortLabel: string
  excerpt: string
  page: number | null
  section: string | null
}

const MIN_LEFT = 260
const MIN_RIGHT = 360
const DEFAULT_LEFT = 380

export function DocumentAudit({ pdfUrl, filename, engagements }: {
  pdfUrl: string | null
  filename: string | null
  engagements: AuditEngagement[]
}) {
  const [i, setI] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT)
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback((px: number) => {
    const c = containerRef.current
    const hardMax = c ? c.clientWidth - MIN_RIGHT : 720
    return Math.max(MIN_LEFT, Math.min(hardMax, px))
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setLeftWidth(clamp(e.clientX - rect.left))
  }
  function endDrag() {
    if (!dragging) return
    setDragging(false)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  // Navigation clavier (← →) entre engagements.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') setI((x) => Math.min(engagements.length - 1, x + 1))
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engagements.length])

  if (engagements.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Aucun engagement détecté dans ce dossier.</p>
  }
  const cur = engagements[i]
  const level = citationLevel(cur.page, cur.section)
  // On ne saute à une page PRÉCISE que si elle est FIABLE (niveau exact). Sinon on
  // ouvre le document entier — jamais vers une page potentiellement inventée.
  const src = pdfUrl ? (level === 'exact' ? `${pdfUrl}#page=${cur.page}&view=FitH` : `${pdfUrl}#view=FitH`) : null
  const go = (d: number) => setI((x) => Math.min(engagements.length - 1, Math.max(0, x + d)))
  const iframeKey = level === 'exact' ? `p-${cur.page}` : 'whole'

  return (
    <div ref={containerRef} className="flex flex-col lg:flex-row lg:items-stretch gap-0 min-h-[480px]">
      {/* GAUCHE — liste navigable (largeur redimensionnable en desktop). */}
      <aside style={{ width: leftWidth }} className="max-lg:!w-full lg:shrink-0 space-y-2">
        <div className="flex items-center justify-between rounded-lg border bg-card px-2 py-1.5">
          <button type="button" onClick={() => go(-1)} disabled={i === 0}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted/50 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" /> Précédent
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">{i + 1} / {engagements.length}</span>
          <button type="button" onClick={() => go(1)} disabled={i === engagements.length - 1}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted/50 disabled:opacity-40">
            Suivant <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <ul className="space-y-1 max-h-[calc(100vh-13rem)] overflow-auto pr-1">
          {engagements.map((e, idx) => {
            const active = idx === i
            return (
              <li key={e.id}>
                <button type="button" onClick={() => setI(idx)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${active ? 'border-sky-400 bg-sky-50/60' : 'bg-card hover:border-foreground/30'}`}>
                  <span className="flex items-center gap-1.5 mb-0.5">
                    {e.kind && <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${KIND_META[e.kind].badge}`}>{KIND_META[e.kind].label}</span>}
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {(() => { const l = citationLevel(e.page, e.section); return l === 'exact' ? `p.${e.page}` : l === 'section' ? `§${e.section}` : 'réf. approximative' })()}
                    </span>
                  </span>
                  <span className="block text-sm font-medium">{e.shortLabel}</span>
                  {active && e.excerpt && (
                    <blockquote className="mt-1 text-[12px] italic text-muted-foreground border-l-2 border-sky-300 pl-2">« {e.excerpt} »</blockquote>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      {/* GLISSIÈRE (desktop) — déplacer la frontière gauche/droite. */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Glisser pour redimensionner"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="group hidden lg:flex shrink-0 cursor-col-resize touch-none select-none items-center justify-center self-stretch px-1.5"
      >
        <div className={`h-20 w-1.5 rounded-full transition-colors ${dragging ? 'bg-primary' : 'bg-border group-hover:bg-primary/60'}`} />
      </div>

      {/* DROITE — PDF à la page de l'engagement courant. */}
      <div className="min-w-0 lg:flex-1 rounded-xl border bg-card overflow-hidden lg:mt-0 mt-3">
        {src ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <span className="text-xs text-muted-foreground truncate inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> {filename ?? 'Document'}
                {level === 'exact' ? ` — page ${cur.page}` : level === 'section' ? ` — chapitre ${cur.section} (page non fiable)` : ' — référence approximative'}
              </span>
              <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline shrink-0">
                <ExternalLink className="h-3.5 w-3.5" /> Onglet
              </a>
            </div>
            <iframe
              key={iframeKey}
              src={src}
              title={`${filename ?? 'Document'} — page ${cur.page ?? 1}`}
              className="w-full h-[calc(100vh-12rem)] min-h-[460px]"
            />
            {level !== 'exact' && (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground border-t">
                {level === 'section'
                  ? `Page non identifiée de façon fiable — cherchez l'extrait${cur.section ? ` au chapitre ${cur.section}` : ''}. L'extrait à gauche reste la trace exacte.`
                  : "Référence approximative : pas de localisation fiable dans le document. L'extrait à gauche reste la trace exacte."}
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p className="text-sm">Document source indisponible.</p>
          </div>
        )}
      </div>
    </div>
  )
}
