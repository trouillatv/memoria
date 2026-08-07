import type { ForceGraphEngine } from '@/components/graph/force-graph-engine'

export function wrapLabel(s: string, maxLine = 14): [string, string] {
  if (s.length <= maxLine) return [s, '']
  const dash = s.indexOf(' — ')
  if (dash > 0 && dash <= maxLine + 2) {
    const l1 = s.slice(0, dash)
    const rest = s.slice(dash + 3)
    return [l1, rest.length > maxLine ? rest.slice(0, maxLine - 1) + '…' : rest]
  }
  const sp = s.lastIndexOf(' ', maxLine)
  if (sp > 3) {
    const l1 = s.slice(0, sp)
    const rest = s.slice(sp + 1)
    return [l1, rest.length > maxLine ? rest.slice(0, maxLine - 1) + '…' : rest]
  }
  return [
    s.slice(0, maxLine),
    s.slice(maxLine, maxLine * 2 - 1) + (s.length > maxLine * 2 ? '…' : ''),
  ]
}

export interface FitItem {
  id: string
  radius: number
}

export function fitToContent(
  engine: ForceGraphEngine,
  items: FitItem[],
  padding = 20,
): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const { id, radius } of items) {
    const p = engine.P[id]
    if (!p) continue
    const r = radius + 5
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r)
    minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r)
  }
  if (!isFinite(minX)) return
  const { W, H } = engine.size()
  const gW = maxX - minX + padding * 2
  const gH = maxY - minY + padding * 2
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const k = Math.min(W / gW, H / gH, 2.5)
  engine.view.k = Math.max(0.35, Math.min(3, k))
  engine.view.tx = W / 2 - cx * engine.view.k
  engine.view.ty = H / 2 - cy * engine.view.k
  engine.redraw()
}

export function zoomEngine(engine: ForceGraphEngine, factor: number): void {
  const { W, H } = engine.size()
  const nextK = Math.max(0.35, Math.min(3, engine.view.k * factor))
  const sx = W / 2, sy = H / 2
  const wx = (sx - engine.view.tx) / engine.view.k
  const wy = (sy - engine.view.ty) / engine.view.k
  engine.view.k = nextK
  engine.view.tx = sx - wx * nextK
  engine.view.ty = sy - wy * nextK
  engine.redraw()
}
