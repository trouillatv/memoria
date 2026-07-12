'use client'

// Visionneuse PDF de l'audit documentaire — pdf.js AVEC COUCHE TEXTE
// (Vincent 2026-07-13) : le PDF n'est plus un document consulté, c'est le
// SUPPORT ANNOTÉ de l'audit. Tous les engagements localisables de la page
// portent leur badge [n] en marge (couleur par type), cliquable ; celui qui
// est sélectionné est surligné (halo jaune), la page défile jusqu'à lui,
// flash d'une seconde, puis le halo reste — comme Acrobat.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

/** Une annotation à porter sur le document : un engagement localisable. */
export interface PdfAnnotation {
  id: string
  /** Numéro affiché dans la marge — l'ordre de la liste d'audit. */
  index: number
  page: number
  excerpt: string
  kindLabel: string
  /** Couleur du badge (type d'engagement). */
  color: string
}

/** Normalisation tolérante : le texte PDF est découpé en fragments arbitraires,
 *  avec espaces/casse/accents variables. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch))
}

export function PdfAuditViewer({
  url,
  page,
  highlight,
  annotations = [],
  currentId = null,
  onSelect,
  heightClass = 'h-[calc(100vh-12rem)]',
}: {
  url: string
  /** Page cible (1-based) — null : document entier depuis la page 1. */
  page: number | null
  /** L'extrait à surligner sur la page cible (engagement sélectionné). */
  highlight: string | null
  /** TOUS les engagements localisables — badges en marge sur leur page. */
  annotations?: PdfAnnotation[]
  currentId?: string | null
  onSelect?: (id: string) => void
  heightClass?: string
}) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [current, setCurrent] = useState(page ?? 1)
  // Zoom : facteur sur la largeur de rendu — la couche texte (et donc le halo)
  // suit, c'est le même rendu pdf.js à une autre échelle.
  const [zoom, setZoom] = useState(1)
  // PDF scanné / OCR absent : l'extrait est attendu mais introuvable dans la
  // couche texte → on le DIT, on ne laisse pas croire que la phrase n'y est pas.
  const [notFound, setNotFound] = useState(false)
  // Badges de marge : [n] positionné à la hauteur du premier fragment trouvé.
  const [badges, setBadges] = useState<Array<{ id: string; index: number; top: number; color: string; label: string; active: boolean }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageWrapRef = useRef<HTMLDivElement>(null)
  const flashedRef = useRef<string | null>(null)

  // L'engagement change → on suit sa page.
  useEffect(() => { setCurrent(page ?? 1) }, [page, highlight])

  const normHighlight = useMemo(() => (highlight ? norm(highlight) : null), [highlight])

  // Les annotations de LA page courante (extrait normalisé prêt à matcher).
  const pageAnnotations = useMemo(
    () => annotations
      .filter((a) => a.page === current && a.excerpt.trim())
      .map((a) => ({ ...a, norm: norm(a.excerpt) }))
      .filter((a) => a.norm.length >= 8),
    [annotations, current],
  )

  // Surligneur : chaque fragment de la couche texte est comparé aux extraits
  // des engagements de la page. Sélectionné → halo jaune ; autres → teinte
  // légère + data-eng (le badge de marge s'y accroche).
  const textRenderer = useMemo(() => {
    if (pageAnnotations.length === 0 && !normHighlight) return undefined
    return ({ str }: { str: string }) => {
      const n = norm(str)
      if (n.length < 4) return esc(str)
      if (normHighlight && current === (page ?? -1) && normHighlight.includes(n)) {
        return `<mark class="audit-hl" data-eng="${currentId ?? ''}">${esc(str)}</mark>`
      }
      const owner = pageAnnotations.find((a) => a.id !== currentId && a.norm.includes(n))
      if (owner) {
        // PERMANENT, dès l'ouverture : fond teinté à la couleur du type —
        // « comme un correcteur qui a annoté le document », pas un simple trait.
        return `<mark class="audit-hl-other" data-eng="${owner.id}" style="background:${owner.color}2b;border-bottom:2px solid ${owner.color}">${esc(str)}</mark>`
      }
      return esc(str)
    }
  }, [pageAnnotations, normHighlight, current, page, currentId])

  // Après rendu : badges de marge + défilement/flash sur la sélection.
  // STABILISÉ (useCallback) et setState UNIQUEMENT si la valeur change :
  // sinon Page voit une prop neuve à chaque rendu, re-rend la couche texte,
  // qui rappelle ce callback → boucle = surlignage qui scintille.
  const lastBadgesKey = useRef('')
  const onRendered = useCallback(() => {
    const root = scrollRef.current
    const wrap = pageWrapRef.current
    if (!root || !wrap) return

    // 1) Positionner un badge [n] au premier fragment de chaque engagement.
    const wrapRect = wrap.getBoundingClientRect()
    const seen = new Set<string>()
    const next: Array<{ id: string; index: number; top: number; color: string; label: string; active: boolean }> = []
    root.querySelectorAll<HTMLElement>('mark[data-eng]').forEach((m) => {
      const id = m.dataset.eng
      if (!id || seen.has(id)) return
      seen.add(id)
      const a = pageAnnotations.find((x) => x.id === id) ?? annotations.find((x) => x.id === id)
      if (!a) return
      next.push({
        id,
        index: a.index,
        top: Math.round(m.getBoundingClientRect().top - wrapRect.top),
        color: a.color,
        label: a.kindLabel,
        active: id === currentId,
      })
    })
    next.sort((x, y) => x.top - y.top)
    const nextKey = JSON.stringify(next)
    if (nextKey !== lastBadgesKey.current) {
      lastBadgesKey.current = nextKey
      setBadges(next)
    }

    // 2) Sélection : scroll + flash (une fois par cible), halo persistant.
    const key = `${current}:${normHighlight ?? ''}`
    const first = root.querySelector('mark.audit-hl')
    setNotFound((prev) => {
      const v = !!normHighlight && current === (page ?? -1) && !first
      return v === prev ? prev : v
    })
    if (first && flashedRef.current !== key) {
      flashedRef.current = key
      first.scrollIntoView({ block: 'center', behavior: 'smooth' })
      root.querySelectorAll('mark.audit-hl').forEach((m) => m.classList.add('audit-hl-flash'))
      setTimeout(() => root.querySelectorAll('mark.audit-hl').forEach((m) => m.classList.remove('audit-hl-flash')), 1100)
    }
  }, [pageAnnotations, annotations, normHighlight, current, page, currentId])

  return (
    <div className="flex min-h-0 flex-col">
      {/* Halo jaune permanent (sélection) ; flash 1 s ; les AUTRES engagements
          de la page : soulignés à la couleur de leur type, cliquables. */}
      <style>{`
        mark.audit-hl { background: rgba(250, 204, 21, .45); color: inherit; border-radius: 2px; padding: 0; }
        mark.audit-hl-flash { background: rgba(245, 158, 11, .85); transition: background .3s; }
        mark.audit-hl-other { color: inherit; padding: 0; border-radius: 2px; cursor: pointer; }
        .react-pdf__Page { margin: 0 auto; }
      `}</style>

      <div
        ref={scrollRef}
        className={`${heightClass} min-h-[460px] overflow-auto bg-muted/30`}
        onClick={(e) => {
          // Cliquer un passage souligné = sélectionner son engagement.
          const m = (e.target as HTMLElement).closest?.('mark[data-eng]') as HTMLElement | null
          const id = m?.dataset.eng
          if (id && onSelect) onSelect(id)
        }}
      >
        <div ref={pageWrapRef} className="relative mx-auto w-fit pl-11">
          {/* LA MARGE — les badges [n] des engagements de la page. */}
          {badges.map((b) => (
            <button
              key={b.id}
              type="button"
              title={`${b.label} n°${b.index}`}
              onClick={() => onSelect?.(b.id)}
              className="absolute left-0 z-10 -translate-y-1/2 rounded-md border bg-card px-1.5 py-0.5 text-[11px] font-bold tabular-nums shadow-sm transition-transform"
              style={{
                top: b.top + 8,
                borderColor: b.color,
                color: b.color,
                transform: b.active ? 'scale(1.25) translateY(-40%)' : undefined,
                boxShadow: b.active ? `0 0 0 2px ${b.color}33` : undefined,
              }}
            >
              {b.index}
            </button>
          ))}

          <Document
            file={url}
            onLoadSuccess={(d) => setNumPages(d.numPages)}
            loading={<div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            error={<p className="py-20 text-center text-sm text-muted-foreground">Impossible d&apos;afficher le PDF ici — utilisez « Onglet ».</p>}
          >
            <Page
              pageNumber={Math.max(1, Math.min(current, numPages ?? current))}
              width={Math.round(860 * zoom)}
              customTextRenderer={textRenderer}
              onRenderTextLayerSuccess={onRendered}
              renderAnnotationLayer={false}
            />
          </Document>
        </div>
      </div>

      {/* PDF scanné / extrait absent de la couche texte : le dire, honnêtement. */}
      {notFound && (
        <p className="border-t px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          Extrait non localisable dans le texte de cette page (document scanné ou OCR imparfait ?)
          — l&apos;extrait à gauche reste la trace exacte.
        </p>
      )}

      {/* Navigation de pages + zoom — lire autour de la citation. */}
      {numPages !== null && (
        <div className="flex items-center justify-center gap-3 border-t px-3 py-1.5 text-xs">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))} disabled={zoom <= 0.6}
            aria-label="Réduire" className="rounded px-2 py-1 hover:bg-muted/50 disabled:opacity-40">−</button>
          <span className="w-10 text-center tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(2.6, Math.round((z + 0.2) * 10) / 10))} disabled={zoom >= 2.6}
            aria-label="Agrandir" className="rounded px-2 py-1 hover:bg-muted/50 disabled:opacity-40">+</button>
          <span className="text-border">|</span>
          <button type="button" onClick={() => setCurrent((p) => Math.max(1, p - 1))} disabled={current <= 1}
            className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-muted/50 disabled:opacity-40">
            <ChevronLeft className="h-3.5 w-3.5" /> Page préc.
          </button>
          <span className="tabular-nums text-muted-foreground">{current} / {numPages}</span>
          <button type="button" onClick={() => setCurrent((p) => Math.min(numPages, p + 1))} disabled={current >= numPages}
            className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-muted/50 disabled:opacity-40">
            Page suiv. <ChevronRight className="h-3.5 w-3.5" />
          </button>
          {page !== null && current !== page && (
            <button type="button" onClick={() => setCurrent(page)} className="text-sky-700 underline underline-offset-2">
              Revenir à la citation (p.{page})
            </button>
          )}
        </div>
      )}
    </div>
  )
}
