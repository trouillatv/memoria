'use client'

// Visionneuse PDF de l'audit documentaire — pdf.js AVEC COUCHE TEXTE
// (Vincent 2026-07-13) : « je clique sur un engagement → mes yeux vont
// immédiatement sur la phrase du document. » L'iframe du lecteur natif ne
// savait pas surligner ; ici l'extrait est marqué (halo jaune), la page
// défile jusqu'à lui, un flash d'une seconde attire l'œil, puis le halo reste.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

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

export function PdfAuditViewer({
  url,
  page,
  highlight,
  heightClass = 'h-[calc(100vh-12rem)]',
}: {
  url: string
  /** Page cible (1-based) — null : document entier depuis la page 1. */
  page: number | null
  /** L'extrait à surligner sur la page cible. */
  highlight: string | null
  heightClass?: string
}) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [current, setCurrent] = useState(page ?? 1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const flashedRef = useRef<string | null>(null)

  // L'engagement change → on suit sa page.
  useEffect(() => { setCurrent(page ?? 1) }, [page, highlight])

  const normHighlight = useMemo(() => (highlight ? norm(highlight) : null), [highlight])

  // Surligneur : un fragment de la couche texte est marqué s'il appartient
  // (normalisé) à l'extrait. Les fragments très courts (« de », « le ») ne
  // comptent que s'ils sont voisins d'un fragment déjà marqué — approximation
  // honnête : on marque les fragments significatifs de la phrase.
  const textRenderer = useMemo(() => {
    if (!normHighlight || current !== (page ?? -1)) return undefined
    return ({ str }: { str: string }) => {
      const n = norm(str)
      if (n.length >= 4 && normHighlight.includes(n)) {
        return `<mark class="audit-hl">${str.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch))}</mark>`
      }
      return str.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch))
    }
  }, [normHighlight, current, page])

  // Après rendu : défiler jusqu'au premier surlignage + flash (une fois par cible).
  function onRendered() {
    const key = `${current}:${normHighlight ?? ''}`
    const root = scrollRef.current
    if (!root) return
    const first = root.querySelector('mark.audit-hl')
    if (first && flashedRef.current !== key) {
      flashedRef.current = key
      first.scrollIntoView({ block: 'center', behavior: 'smooth' })
      root.querySelectorAll('mark.audit-hl').forEach((m) => m.classList.add('audit-hl-flash'))
      setTimeout(() => root.querySelectorAll('mark.audit-hl').forEach((m) => m.classList.remove('audit-hl-flash')), 1100)
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Le halo : jaune translucide permanent ; le flash : 1 s plus saturé. */}
      <style>{`
        mark.audit-hl { background: rgba(250, 204, 21, .45); color: inherit; border-radius: 2px; padding: 0; }
        mark.audit-hl-flash { background: rgba(245, 158, 11, .85); transition: background .3s; }
        .react-pdf__Page { margin: 0 auto; }
      `}</style>

      <div ref={scrollRef} className={`${heightClass} min-h-[460px] overflow-auto bg-muted/30`}>
        <Document
          file={url}
          onLoadSuccess={(d) => setNumPages(d.numPages)}
          loading={<div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          error={<p className="py-20 text-center text-sm text-muted-foreground">Impossible d&apos;afficher le PDF ici — utilisez « Onglet ».</p>}
        >
          <Page
            pageNumber={Math.max(1, Math.min(current, numPages ?? current))}
            width={860}
            customTextRenderer={textRenderer}
            onRenderTextLayerSuccess={onRendered}
            renderAnnotationLayer={false}
          />
        </Document>
      </div>

      {/* Navigation de pages — lire autour de la citation. */}
      {numPages !== null && numPages > 1 && (
        <div className="flex items-center justify-center gap-3 border-t px-3 py-1.5 text-xs">
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
