'use client'

// Annotation photo — « regarde EXACTEMENT ici ». Le conducteur entoure, fléche,
// surligne, écrit un mot. Rouge par défaut. On EXPORTE une image annotée qui
// s'ajoute EN PLUS de l'original (jamais détruire la preuve). Canvas simple,
// tactile ; les formes sont mémorisées → on peut effacer la dernière.

import { useEffect, useRef, useState } from 'react'
import { X, Pencil, ArrowUpRight, Circle, Type, Undo2, Loader2, Check, Eraser, AlertCircle, RotateCcw } from 'lucide-react'
import { fetchAnnotationImageAction } from './capture-actions'

type Tool = 'draw' | 'arrow' | 'circle' | 'text' | 'erase'
type Pt = { x: number; y: number }
type Shape =
  | { tool: 'draw'; color: string; points: Pt[]; width: number }
  | { tool: 'arrow'; color: string; a: Pt; b: Pt; width: number }
  | { tool: 'circle'; color: string; a: Pt; b: Pt; width: number }
  | { tool: 'text'; color: string; at: Pt; text: string; scale: number }

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111827']
// Épaisseur de trait (multiplicateurs). La BASE est proportionnelle à l'image
// (≈ largeur/350) pour rester visible une fois la photo affichée en grand. « Fin »
// = l'ancien trait (conservé), + deux crans plus épais.
const STROKE_SIZES: Array<{ key: string; label: string; scale: number }> = [
  { key: 'S', label: 'Fin', scale: 1 },
  { key: 'M', label: 'Moyen', scale: 2.2 },
  { key: 'L', label: 'Épais', scale: 4 },
]
// Tailles de texte (multiplicateurs). La taille de BASE est proportionnelle à
// l'image (≈ largeur/18) : « Fissure » écrit sur le chantier doit rester lisible
// à 2 m, pas noyé dans une photo de 1400 px. Contour blanc + texte coloré.
const TEXT_SIZES: Array<{ key: string; label: string; scale: number }> = [
  { key: 'S', label: 'Petit', scale: 0.7 },
  { key: 'M', label: 'Moyen', scale: 1 },
  { key: 'L', label: 'Grand', scale: 1.6 },
]

/** Épaisseur de trait EFFECTIVE (px canvas) pour un multiplicateur donné. */
function strokeWidth(canvasWidth: number, scale: number): number {
  return Math.max(2, Math.round((canvasWidth / 350) * scale))
}

export function PhotoAnnotator({
  imageUrl,
  onCancel,
  onSave,
}: {
  imageUrl: string
  onCancel: () => void
  /** `replaceOriginal` : remplacer l'affichage par la version annotée (l'original
   *  reste archivé) ou conserver les deux. Cf. mig 185. */
  onSave: (file: File, replaceOriginal: boolean) => void | Promise<void>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [tool, setTool] = useState<Tool>('draw')
  const [color, setColor] = useState(COLORS[0])
  const [textScale, setTextScale] = useState(1)
  const [strokeScale, setStrokeScale] = useState(2.2) // « Moyen » par défaut (l'ancien trait était trop fin)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [saving, setSaving] = useState(false)
  // Fichier annoté exporté, en attente du choix « remplacer / conserver les deux ».
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const draft = useRef<Shape | null>(null)

  // Charge l'image via le SERVEUR (data URL) : les URLs signées Supabase n'ont pas
  // d'en-tête CORS, donc un chargement crossOrigin (nécessaire pour exporter le
  // canvas) échouait → spinner infini. Un data URL est de même origine : il
  // s'affiche ET s'exporte. Erreur explicite au lieu d'un spinner sans fin.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setReady(false)
      setError(false)
      const r = await fetchAnnotationImageAction(imageUrl)
      if (cancelled) return
      if (!r.ok) { setError(true); return }
      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        imgRef.current = img
        const canvas = canvasRef.current
        if (!canvas) return
        // Taille interne = image, plafonnée (perf) ; l'affichage est géré en CSS.
        const maxW = 1400
        const scale = Math.min(1, maxW / img.naturalWidth)
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        setReady(true)
      }
      img.onerror = () => { if (!cancelled) setError(true) }
      img.src = r.dataUrl
    })()
    return () => { cancelled = true }
  }, [imageUrl, attempt])

  // Redessine : image de fond + toutes les formes (+ le brouillon en cours).
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const all = draft.current ? [...shapes, draft.current] : shapes
    for (const s of all) drawShape(ctx, s)
  })

  function toCanvas(e: React.PointerEvent): Pt {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    }
  }

  function redraw() {
    // force le re-render (l'effet ci-dessus redessine)
    setShapes((s) => [...s])
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!ready) return
    e.preventDefault()
    const p = toCanvas(e)
    if (tool === 'erase') {
      // Gomme : on retire l'annotation la PLUS RÉCENTE touchée (texte, cercle,
      // flèche ou trait) — permet de viser n'importe laquelle, pas seulement la dernière.
      const w = canvasRef.current?.width ?? 0
      setShapes((s) => {
        for (let i = s.length - 1; i >= 0; i--) {
          if (hitShape(s[i], p, w)) { const c = s.slice(); c.splice(i, 1); return c }
        }
        return s
      })
      return
    }
    if (tool === 'text') {
      const text = window.prompt('Texte :')?.trim()
      if (text) setShapes((s) => [...s, { tool: 'text', color, at: p, text, scale: textScale }])
      return
    }
    draft.current =
      tool === 'draw' ? { tool: 'draw', color, points: [p], width: strokeScale }
      : tool === 'arrow' ? { tool: 'arrow', color, a: p, b: p, width: strokeScale }
      : { tool: 'circle', color, a: p, b: p, width: strokeScale }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    redraw()
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draft.current) return
    const p = toCanvas(e)
    const d = draft.current
    if (d.tool === 'draw') d.points.push(p)
    else if (d.tool === 'arrow' || d.tool === 'circle') d.b = p
    redraw()
  }

  function onPointerUp() {
    if (!draft.current) return
    const d = draft.current
    draft.current = null
    // Ignore les gestes quasi nuls (tap sans mouvement) pour arrow/circle.
    if ((d.tool === 'arrow' || d.tool === 'circle') && dist(d.a, d.b) < 6) { redraw(); return }
    setShapes((s) => [...s, d])
  }

  // Étape 1 — exporter l'image annotée, puis DEMANDER le choix (on ne sauve pas
  // encore). L'original n'est jamais perdu ; le choix ne porte que sur l'AFFICHAGE.
  async function exportAndAsk() {
    const canvas = canvasRef.current
    if (!canvas || saving || pendingFile) return
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
    if (!blob) return
    setPendingFile(new File([blob], 'annotation.jpg', { type: 'image/jpeg' }))
  }

  // Étape 2 — le conducteur a tranché : remplacer l'affichage, ou garder les deux.
  async function confirmSave(replaceOriginal: boolean) {
    if (!pendingFile || saving) return
    setSaving(true)
    try {
      await onSave(pendingFile, replaceOriginal)
    } catch {
      setSaving(false)
      setPendingFile(null)
    }
  }

  const TOOLS: Array<{ t: Tool; icon: typeof Pencil; label: string }> = [
    { t: 'draw', icon: Pencil, label: 'Dessiner' },
    { t: 'arrow', icon: ArrowUpRight, label: 'Flèche' },
    { t: 'circle', icon: Circle, label: 'Cercle' },
    { t: 'text', icon: Type, label: 'Texte' },
    { t: 'erase', icon: Eraser, label: 'Gomme' },
  ]

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <button type="button" onClick={onCancel} aria-label="Annuler" className="rounded-full bg-white/10 p-2"><X className="h-5 w-5" /></button>
        <span className="text-sm font-medium">Annoter la photo</span>
        <button
          type="button" onClick={exportAndAsk} disabled={saving || !!pendingFile}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden p-2">
        {!ready && !error && <Loader2 className="h-6 w-6 animate-spin text-white/70" />}
        {error && (
          <div className="flex max-w-xs flex-col items-center gap-3 px-4 text-center text-white/80">
            <AlertCircle className="h-8 w-8 text-white/60" />
            <p className="text-sm">Impossible de charger la photo pour l&apos;annoter.</p>
            <button
              type="button" onClick={() => setAttempt((a) => a + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium"
            >
              <RotateCcw className="h-4 w-4" /> Réessayer
            </button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="max-h-full max-w-full touch-none rounded-lg"
          style={{ display: ready ? 'block' : 'none' }}
        />
      </div>

      <div className="space-y-2 border-t border-white/10 p-3 safe-bottom">
        <div className="grid grid-cols-3 gap-1.5">
          {TOOLS.map(({ t, icon: Icon, label }) => (
            <button
              key={t} type="button" onClick={() => setTool(t)}
              className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium ${tool === t ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
          <button
            type="button" onClick={() => setShapes((s) => s.slice(0, -1))} disabled={shapes.length === 0}
            className="flex flex-col items-center gap-1 rounded-lg bg-white/10 px-1 py-2 text-[11px] font-medium text-white disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" /> Annuler
          </button>
        </div>
        {tool === 'erase' && (
          <p className="text-center text-[11px] text-white/70">Touchez une annotation pour l&apos;effacer.</p>
        )}
        {(tool === 'draw' || tool === 'arrow' || tool === 'circle') && (
          <div className="flex items-center justify-center gap-1.5">
            <span className="mr-1 text-[11px] text-white/50">Trait</span>
            {STROKE_SIZES.map((sz) => (
              <button
                key={sz.key} type="button" onClick={() => setStrokeScale(sz.scale)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${strokeScale === sz.scale ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                {sz.label}
              </button>
            ))}
          </div>
        )}
        {tool === 'text' && (
          <div className="flex items-center justify-center gap-1.5">
            <span className="mr-1 text-[11px] text-white/50">Texte</span>
            {TEXT_SIZES.map((sz) => (
              <button
                key={sz.key} type="button" onClick={() => setTextScale(sz.scale)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${textScale === sz.scale ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                {sz.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c} type="button" onClick={() => setColor(c)} aria-label={`Couleur ${c}`}
              className={`h-6 w-6 rounded-full ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-black' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Choix à l'enregistrement : l'original est TOUJOURS conservé ; on ne décide
          que de ce qu'on AFFICHE par défaut. */}
      {pendingFile && (
        <div className="absolute inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-card p-4 text-foreground">
            <h3 className="text-sm font-semibold">Photo annotée prête</h3>
            <p className="text-[13px] text-muted-foreground">
              L&apos;original est toujours conservé. Que veut-on voir par défaut ?
            </p>
            <button
              type="button" onClick={() => confirmSave(true)} disabled={saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Remplacer par la version annotée
            </button>
            <button
              type="button" onClick={() => confirmSave(false)} disabled={saving}
              className="flex w-full items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Conserver les deux
            </button>
            <p className="text-center text-[11px] text-muted-foreground">L&apos;original reste archivé et consultable.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function dist(a: Pt, b: Pt) { return Math.hypot(b.x - a.x, b.y - a.y) }

/** Distance d'un point au segment [a,b] — pour toucher une flèche/un trait. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return dist(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/** La forme est-elle « touchée » par le point `p` (gomme) ? Tolérance tactile
 *  proportionnelle à l'image. On teste de la plus récente à la plus ancienne. */
function hitShape(s: Shape, p: Pt, canvasWidth: number): boolean {
  const near = Math.max(12, canvasWidth / 55)
  if (s.tool === 'draw') return s.points.some((pt) => dist(pt, p) < near)
  if (s.tool === 'arrow') return distToSegment(p, s.a, s.b) < near
  if (s.tool === 'circle') {
    const cx = (s.a.x + s.b.x) / 2, cy = (s.a.y + s.b.y) / 2
    const rx = Math.abs(s.b.x - s.a.x) / 2 || 1, ry = Math.abs(s.b.y - s.a.y) / 2 || 1
    const nx = (p.x - cx) / rx, ny = (p.y - cy) / ry
    return nx * nx + ny * ny <= 1.25 // à l'intérieur ou près du contour
  }
  // texte : boîte englobante approchée (police proportionnelle à l'image)
  const fontSize = Math.max(26, Math.round((canvasWidth / 18) * s.scale))
  const w = s.text.length * fontSize * 0.6
  return p.x >= s.at.x - near && p.x <= s.at.x + w + near && p.y >= s.at.y - near && p.y <= s.at.y + fontSize + near
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Épaisseur EFFECTIVE du trait (proportionnelle à l'image × le cran choisi).
  const lw = s.tool === 'text' ? 0 : strokeWidth(ctx.canvas.width, s.width)
  ctx.lineWidth = lw
  if (s.tool === 'draw') {
    ctx.beginPath()
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
  } else if (s.tool === 'circle') {
    const cx = (s.a.x + s.b.x) / 2, cy = (s.a.y + s.b.y) / 2
    const rx = Math.abs(s.b.x - s.a.x) / 2, ry = Math.abs(s.b.y - s.a.y) / 2
    ctx.beginPath()
    ctx.ellipse(cx, cy, Math.max(rx, 2), Math.max(ry, 2), 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (s.tool === 'arrow') {
    const { a, b } = s
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const head = 14 + lw * 2
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6))
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6))
    ctx.stroke()
  } else {
    // Taille PROPORTIONNELLE à l'image (× le multiplicateur choisi), avec un
    // plancher : lisible à 2 m, jamais minuscule. Contour blanc épais + texte
    // coloré = lisible sur n'importe quel fond de chantier.
    const fontSize = Math.max(26, Math.round((ctx.canvas.width / 18) * s.scale))
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(3, Math.round(fontSize / 5))
    ctx.strokeText(s.text, s.at.x, s.at.y)
    ctx.fillStyle = s.color
    ctx.fillText(s.text, s.at.x, s.at.y)
  }
}
