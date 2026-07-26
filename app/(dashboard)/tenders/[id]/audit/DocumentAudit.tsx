'use client'

// Niveau 2 — Audit documentaire (Vincent 2026-06-22, surlignage 2026-07-13,
// multipièces 2026-07-26). TOUTES les pièces du dossier + liste NAVIGABLE des
// engagements. Le PDF est rendu par pdf.js AVEC couche texte : l'extrait de
// l'engagement courant est SURLIGNÉ (halo jaune), la page défile jusqu'à lui.
// La navigation suit la provenance PERSISTÉE :
//   exact → la bonne pièce, la bonne page ; document_only → la pièce entière ;
//   unavailable → le lecteur ne bouge pas, « Source non localisée ».
// Glissière gauche/droite. « Onglet » reste la sortie plein écran native.
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, FileText, ExternalLink, Loader2 } from 'lucide-react'
import { KIND_META, KIND_ORDER } from '@/lib/engagements/kind'
import type { EngagementKind } from '@/types/db'
import {
  applyProvenanceSelection, initialAuditSelection,
  type AuditDocumentItem, type AuditProvenance, type AuditSelection,
} from './audit-provenance'
import {
  engagementSourceBadge, buildDocumentFilterOptions, ALL_FILTER_VALUE,
  type EngagementSourceDisplay,
} from '@/lib/tenders/engagement-source-display'

// pdf.js n'existe que côté client (worker) — jamais rendu côté serveur.
const PdfAuditViewer = dynamic(() => import('./PdfAuditViewer').then((m) => m.PdfAuditViewer), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>,
})

export interface AuditEngagement {
  id: string
  kind: EngagementKind | null
  shortLabel: string
  excerpt: string
  context: string | null   // paragraphe complet autour de l'extrait (déterministe)
  occurrences: number[]    // pages où le terme canonique apparaît aussi dans le doc
  /** Provenance structurée persistée — la SEULE autorité de navigation. */
  provenance: AuditProvenance
}

const MIN_LEFT = 260
const MIN_RIGHT = 360
const DEFAULT_LEFT = 380

// Couleur des badges de marge — une teinte par type (mêmes familles que les
// pastilles de la liste).
const KIND_COLOR: Record<string, string> = {
  penalite: '#dc2626', controle: '#059669', livrable: '#7c3aed',
  obligation: '#0284c7', objectif: '#64748b',
}

export function DocumentAudit({ documents, engagements }: {
  documents: AuditDocumentItem[]
  engagements: AuditEngagement[]
}) {
  // `null` = aucun engagement sélectionné : la pièce ouverte n'est qu'une
  // cible de consultation, jamais une provenance démontrée.
  const [i, setI] = useState<number | null>(null)
  const [sel, setSel] = useState<AuditSelection>(() => initialAuditSelection(documents))
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

  // Sélectionner un engagement = appliquer sa provenance au lecteur.
  const selectEngagement = useCallback((idx: number) => {
    setI(idx)
    const prov = engagements[idx]?.provenance
    if (prov) setSel((s) => applyProvenanceSelection(s, prov))
  }, [engagements])

  // Choisir une pièce à la main = consultation libre : l'engagement courant est
  // désélectionné pour ne jamais présenter cette pièce comme sa source.
  function selectDocument(id: string) {
    setI(null)
    setSel({ documentId: id, pageNumber: null })
  }

  // La navigation clavier lit l'index courant sans se réabonner à chaque touche.
  // Synchronisé hors render (l'événement clavier arrive après le commit).
  const iRef = useRef<number | null>(i)
  useEffect(() => { iRef.current = i }, [i])

  // Navigation clavier (← → ↑ ↓) entre engagements.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (engagements.length === 0) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        selectEngagement(Math.min(engagements.length - 1, (iRef.current ?? -1) + 1))
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        selectEngagement(Math.max(0, (iRef.current ?? 1) - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engagements.length, selectEngagement])

  if (engagements.length === 0 && documents.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Aucune pièce et aucun engagement dans ce dossier.</p>
  }

  const cur = i !== null ? engagements[i] : null
  const selectedDoc = documents.find((d) => d.id === sel.documentId) ?? null
  const url = selectedDoc?.url ?? null
  const src = url ? (sel.pageNumber !== null ? `${url}#page=${sel.pageNumber}&view=FitH` : `${url}#view=FitH`) : null
  const go = (d: number) => selectEngagement(Math.min(engagements.length - 1, Math.max(0, (i ?? (d > 0 ? -1 : 1)) + d)))
  const viewerKey = `${sel.documentId ?? 'none'}-${sel.pageNumber ?? 'whole'}`
  const curUnavailable = cur !== null && cur.provenance.state === 'unavailable'

  return (
    <div ref={containerRef} className="flex flex-col lg:flex-row lg:items-stretch gap-0 min-h-[480px]">
      {/* GAUCHE — liste navigable (largeur redimensionnable en desktop). */}
      <aside style={{ width: leftWidth }} className="max-lg:!w-full lg:shrink-0 space-y-2">
        <div className="flex items-center justify-between rounded-lg border bg-card px-2 py-1.5">
          <button type="button" onClick={() => go(-1)} disabled={i === 0 || engagements.length === 0}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted/50 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" /> Précédent
          </button>
          <span className="text-xs tabular-nums text-muted-foreground">{i !== null ? i + 1 : '—'} / {engagements.length}</span>
          <button type="button" onClick={() => go(1)} disabled={i === engagements.length - 1 || engagements.length === 0}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted/50 disabled:opacity-40">
            Suivant <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {engagements.length === 0 ? (
          <p className="text-sm text-muted-foreground italic px-1">Aucun engagement détecté dans ce dossier.</p>
        ) : (
        <ul className="space-y-1 max-h-[calc(100vh-13rem)] overflow-auto pr-1">
          {engagements.map((e, idx) => {
            const active = idx === i
            return (
              <li key={e.id}>
                <button type="button" onClick={() => selectEngagement(idx)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${active ? 'border-sky-400 bg-sky-50/60' : 'bg-card hover:border-foreground/30'}`}>
                  <span className="flex items-center gap-1.5 mb-0.5">
                    {/* LE MÊME numéro que sur le PDF (marge + début du surlignage) :
                        la correspondance liste ↔ document est immédiate. */}
                    <span
                      className="inline-flex min-w-5 items-center justify-center rounded-md border px-1 py-0.5 text-[10px] font-bold tabular-nums"
                      style={{ borderColor: e.kind ? KIND_COLOR[e.kind] ?? '#64748b' : '#64748b', color: e.kind ? KIND_COLOR[e.kind] ?? '#64748b' : '#64748b' }}
                    >
                      {idx + 1}
                    </span>
                    {e.kind && <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${KIND_META[e.kind].badge}`}>{KIND_META[e.kind].label}</span>}
                    <span className="text-[10px] text-muted-foreground tabular-nums">{provenancePageBadge(e.provenance)}</span>
                  </span>
                  <span className="block text-sm font-medium">{e.shortLabel}</span>
                  {active && e.excerpt && (
                    <blockquote className="mt-1 text-[12px] italic text-muted-foreground border-l-2 border-sky-300 pl-2">« {e.excerpt} »</blockquote>
                  )}
                  {active && e.context && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-sky-700 hover:underline">Voir le contexte complet</summary>
                      <p className="mt-1 text-[12px] text-muted-foreground bg-muted/30 rounded p-2 leading-relaxed">{e.context}</p>
                    </details>
                  )}
                  {active && e.occurrences.filter((p) => p !== e.provenance.pageNumber).length > 0 && (
                    <span className="block mt-1 text-[11px] text-muted-foreground">
                      Aussi mentionné : {e.occurrences.filter((p) => p !== e.provenance.pageNumber).map((p) => `p.${p}`).join(' · ')}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        )}
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

      {/* DROITE — les pièces du dossier ; le lecteur suit la provenance. */}
      <div className="min-w-0 lg:flex-1 rounded-xl border bg-card overflow-hidden lg:mt-0 mt-3">
        {/* SÉLECTEUR DE PIÈCES — première classe : toutes les pièces du dossier,
            consultables même sans engagement sélectionné. */}
        {documents.length > 0 && (
          <div role="tablist" aria-label="Pièces du dossier" className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
            {documents.map((d) => {
              const active = d.id === sel.documentId
              return (
                <button key={d.id} type="button" role="tab" aria-selected={active}
                  onClick={() => selectDocument(d.id)}
                  className={`inline-flex max-w-56 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${active ? 'border-sky-400 bg-sky-50/60 text-sky-900' : 'bg-card text-muted-foreground hover:border-foreground/30'}`}>
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{d.filename}</span>
                </button>
              )
            })}
          </div>
        )}

        {selectedDoc && src ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <span className="text-xs text-muted-foreground truncate inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                {/* Engagement sélectionné → la provenance persistée fait foi.
                    Sinon → simple consultation, jamais présentée comme source. */}
                {cur ? provenanceSourceLabel(cur.provenance) : `${selectedDoc.filename} — consultation`}
              </span>
              <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline shrink-0">
                <ExternalLink className="h-3.5 w-3.5" /> Onglet
              </a>
            </div>
            {/* LÉGENDE des couleurs — seuls les types présents dans CE dossier. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1.5">
              {KIND_ORDER.filter((k) => engagements.some((e) => e.kind === k)).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `${KIND_COLOR[k]}55`, boxShadow: `inset 0 0 0 1.5px ${KIND_COLOR[k]}` }} aria-hidden />
                  {KIND_META[k].label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-sm bg-yellow-300/70" aria-hidden />
                Sélection
              </span>
            </div>
            <PdfAuditViewer
              key={viewerKey}
              url={url!}
              page={sel.pageNumber}
              // On ne surligne l'extrait que sur SA page démontrée — jamais sur
              // une autre pièce ni sur une page non vérifiée.
              highlight={cur && cur.provenance.state === 'exact' && cur.provenance.documentId === sel.documentId ? cur.excerpt || null : null}
              currentId={cur?.id ?? null}
              onSelect={(id) => {
                const idx = engagements.findIndex((e) => e.id === id)
                if (idx >= 0) selectEngagement(idx)
              }}
              // La pièce affichée porte TOUS ses engagements démontrés (état
              // exact sur CE document) : badge [n] en marge, passage souligné.
              annotations={engagements
                .map((e, idx) => ({ e, idx }))
                .filter(({ e }) => e.provenance.state === 'exact' && e.provenance.documentId === sel.documentId && !!e.excerpt)
                .map(({ e, idx }) => ({
                  id: e.id,
                  index: idx + 1,
                  page: e.provenance.pageNumber as number,
                  excerpt: e.excerpt,
                  kindLabel: e.kind ? KIND_META[e.kind].label : 'Engagement',
                  color: e.kind ? KIND_COLOR[e.kind] ?? '#64748b' : '#64748b',
                }))}
            />
            {curUnavailable && (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground border-t">
                Source non localisée : aucune pièce ni page démontrée pour cet engagement.
                Le lecteur reste sur la pièce consultée ; l&apos;extrait à gauche reste la trace exacte.
              </p>
            )}
            {cur && cur.provenance.state === 'document_only' && (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground border-t">
                Page non localisée dans {cur.provenance.filename} — cherchez l&apos;extrait dans la pièce.
                L&apos;extrait à gauche reste la trace exacte.
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p className="text-sm">{documents.length === 0 ? 'Aucune pièce dans ce dossier.' : 'Document source indisponible.'}</p>
            {curUnavailable && <p className="text-xs">Source non localisée pour cet engagement.</p>}
          </div>
        )}
      </div>
    </div>
  )
}
