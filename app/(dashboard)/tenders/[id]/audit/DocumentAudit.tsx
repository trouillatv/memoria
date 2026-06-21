'use client'

// Niveau 2 — Audit documentaire (Vincent 2026-06-22). PDF du dossier + liste
// NAVIGABLE de tous les engagements détectés. Le PDF saute à la page de chacun
// (#page=N, viewer natif), l'extrait est mis en évidence DANS LA LISTE (pas de
// surlignage au pixel dans le PDF — on n'a pas les coordonnées, et un surlignage
// qui tombe à côté détruirait la confiance). Pas de pdf.js.
import { useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, ExternalLink } from 'lucide-react'
import { KIND_META } from '@/lib/engagements/kind'
import type { EngagementKind } from '@/types/db'

export interface AuditEngagement {
  id: string
  kind: EngagementKind | null
  shortLabel: string
  excerpt: string
  page: number | null
  section: string | null
}

export function DocumentAudit({ pdfUrl, filename, engagements }: {
  pdfUrl: string | null
  filename: string | null
  engagements: AuditEngagement[]
}) {
  const [i, setI] = useState(0)

  if (engagements.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Aucun engagement détecté dans ce dossier.</p>
  }
  const cur = engagements[i]
  const src = pdfUrl ? `${pdfUrl}#page=${cur.page ?? 1}&view=FitH` : null
  const go = (d: number) => setI((x) => Math.min(engagements.length - 1, Math.max(0, x + d)))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
      <aside className="space-y-2 lg:sticky lg:top-4">
        {/* Navigation Suivant / Précédent */}
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

        {/* Liste de tous les engagements — l'actif est mis en évidence + son extrait. */}
        <ul className="space-y-1 max-h-[calc(100vh-14rem)] overflow-auto pr-1">
          {engagements.map((e, idx) => {
            const active = idx === i
            return (
              <li key={e.id}>
                <button type="button" onClick={() => setI(idx)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${active ? 'border-sky-400 bg-sky-50/60' : 'bg-card hover:border-foreground/30'}`}>
                  <span className="flex items-center gap-1.5 mb-0.5">
                    {e.kind && <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${KIND_META[e.kind].badge}`}>{KIND_META[e.kind].label}</span>}
                    <span className="text-[10px] text-muted-foreground tabular-nums">{e.page != null ? `p.${e.page}` : 'page ?'}{e.section ? ` · §${e.section}` : ''}</span>
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

      {/* PDF — saute à la page de l'engagement courant (remonté au changement de page). */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {src ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <span className="text-xs text-muted-foreground truncate inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> {filename ?? 'Document'} — page {cur.page ?? 1}
              </span>
              <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline shrink-0">
                <ExternalLink className="h-3.5 w-3.5" /> Onglet
              </a>
            </div>
            <iframe
              key={cur.page ?? 'nopage'}
              src={src}
              title={`${filename ?? 'Document'} — page ${cur.page ?? 1}`}
              className="w-full h-[calc(100vh-12rem)] min-h-[480px]"
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p className="text-sm">Document source indisponible.</p>
            <p className="text-xs max-w-sm">Les extraits de la liste restent la trace des clauses détectées.</p>
          </div>
        )}
      </div>
    </div>
  )
}
