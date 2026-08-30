import 'server-only'

export interface StructuredTableRow {
  page: number
  dateText: string | null
  weekText: string | null
  description: string
  bbox: [number, number, number, number]
}

export interface StructuredTableContext {
  detected: boolean
  confidence: number
  rows: StructuredTableRow[]
}

const DATE_RE = /\b\d{1,2}[\s-]*(?:janv(?:ier)?|f[eé]vr(?:ier)?|mars|avr(?:il)?|mai|juin|juil(?:let)?|ao[uû]t|sept(?:embre)?|oct(?:obre)?|nov(?:embre)?|d[eé]c(?:embre)?)[a-z]*\b/i
// Semaine : numéro seul ou plage "39-40", optionnellement précédé de "S" ou "sem."
const WEEK_RE = /^\s*(?:s(?:em(?:aine)?)?\s*)?(\d{1,2}(?:\s*[-–]\s*\d{1,2})?)\s*$/i

type Line = { x: number; y: number; w: number; h: number; text: string }

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

/**
 * Pour n lignes symétriques autour d'un centre Y_c avec un espacement `rowSpacing` :
 *   n pair  → lignes à Y_c ± halfSpacing, Y_c ± (halfSpacing + rowSpacing), ...
 *   n impair → lignes à Y_c, Y_c ± rowSpacing, Y_c ± 2*rowSpacing, ...
 *
 * Le centre Y_c est toujours le milieu géométrique du groupe.
 */
function expectedRowYs(centerY: number, n: number, halfSpacing: number, rowSpacing: number): number[] {
  if (n <= 0) return []
  const ys: number[] = []
  if (n % 2 === 0) {
    for (let k = 0; k < n / 2; k++) {
      ys.push(centerY - halfSpacing - k * rowSpacing)
      ys.push(centerY + halfSpacing + k * rowSpacing)
    }
  } else {
    ys.push(centerY)
    for (let k = 1; k <= (n - 1) / 2; k++) {
      ys.push(centerY - k * rowSpacing)
      ys.push(centerY + k * rowSpacing)
    }
  }
  return ys.sort((a, b) => a - b)
}

function pickRow(rows: Line[], targetY: number, tol: number, claimed: Set<number>): Line | undefined {
  return rows.find(r => Math.abs(r.y - targetY) <= tol && !claimed.has(r.y))
}

/**
 * Lecteur géométrique déterministe pour les tableaux de planning PDF.
 *
 * Principe : dans ce type de tableau, chaque cellule date/semaine est fusionnée
 * verticalement sur N lignes de description. MuPDF place le texte de la cellule
 * fusionnée au CENTRE géométrique du groupe. Les lignes de description sont
 * régulièrement espacées (espacement `rowSpacing`). On peut donc retrouver les N
 * lignes par symétrie autour du centre sans avoir besoin des traits de séparation.
 *
 * La méthode `walk(onTextBlock)` de MuPDF ne fire pas sur tous les PDF : on
 * utilise `asJSON()` qui expose la même structure de façon fiable.
 */
export async function extractStructuredTableContext(buffer: Buffer): Promise<StructuredTableContext> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mu = (await import('mupdf')) as any
    const doc = mu.Document.openDocument(new Uint8Array(buffer), 'application/pdf')
    const allRows: StructuredTableRow[] = []
    const pages: number = typeof doc.countPages === 'function' ? doc.countPages() : 0
    let totalDescRows = 0
    let totalClaimedRows = 0

    for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
      const page = doc.loadPage(pageIndex)
      const st = page.toStructuredText()

      // ── Extraire toutes les lignes de texte via asJSON() ──────────────────
      const lines: Line[] = []
      try {
        const rawJson = st.asJSON()
        if (rawJson) {
          const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const block of (parsed.blocks ?? []) as any[]) {
            if (block.type !== 'text') continue
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const line of (block.lines ?? []) as any[]) {
              const b = line.bbox
              const text = String(line.text ?? '').trim()
              if (text && b?.x != null) lines.push({ x: b.x, y: b.y, w: b.w, h: b.h, text })
            }
          }
        }
      } catch { /* pas de JSON disponible → page ignorée */ }

      st.destroy()
      page.destroy()

      if (lines.length === 0) continue

      // ── Détecter l'en-tête du tableau planning ────────────────────────────
      const dateHeader = lines.find(l => /^date$/i.test(l.text))
      const weekHeader = lines.find(l => /^semaine$/i.test(l.text))
      const descHeader = lines.find(l => /description/i.test(l.text))
      if (!dateHeader || !weekHeader || !descHeader) continue

      const headerY = dateHeader.y

      // ── Définir les plages X des colonnes depuis l'en-tête ───────────────
      // Colonne Date   : x < (x_semaine - marge)
      // Colonne Semaine: x proche de l'en-tête semaine
      // Colonne Desc   : x > (colonne semaine droite)
      const DATE_X_MAX = weekHeader.x - 2
      const WEEK_X_MIN = weekHeader.x - 8
      const WEEK_X_MAX = weekHeader.x + weekHeader.w + 25  // espace colonne semaine

      // Lignes sous l'en-tête uniquement
      const content = lines.filter(l => l.y > headerY + 5)

      // ── Identifier les marqueurs date, semaine, description ───────────────
      const dateMarkers = content
        .filter(l => l.x < DATE_X_MAX && DATE_RE.test(l.text))
        .sort((a, b) => a.y - b.y)

      const weekMarkers = content
        .filter(l => l.x >= WEEK_X_MIN && l.x <= WEEK_X_MAX && WEEK_RE.test(l.text))
        .sort((a, b) => a.y - b.y)

      // Description : à droite de la colonne semaine, texte substantiel
      const descRows = content
        .filter(l => {
          if (l.x < WEEK_X_MAX - 10) return false         // trop à gauche
          if (l.text.length < 6) return false               // trop court
          if (/^\d[\d\s]*%?$/.test(l.text)) return false  // chiffre ou pourcentage pur
          // Éviter les dates mal placées (ex. "Réception provisoire le 28 sept…")
          // dans la colonne de description : acceptées si texte long
          return true
        })
        .sort((a, b) => a.y - b.y)

      if (dateMarkers.length === 0 || descRows.length === 0) continue

      totalDescRows += descRows.length

      // ── Espacement inter-lignes ───────────────────────────────────────────
      const gaps: number[] = []
      for (let i = 1; i < descRows.length; i++) gaps.push(descRows[i].y - descRows[i - 1].y)
      const rowSpacing = Math.max(gaps.length > 0 ? Math.round(median(gaps)) : 14, 6)
      const halfSpacing = rowSpacing / 2
      // Tolérance : ≈ 30 % du demi-espacement, minimum 2 pts
      const TOLERANCE = Math.max(2, Math.round(halfSpacing * 0.35))

      // ── Regroupement géométrique ──────────────────────────────────────────
      // Traiter les groupes de haut en bas pour que les lignes revendiquées
      // par un groupe ne soient plus disponibles pour le suivant.
      const claimedYs = new Set<number>()

      for (const dateMk of dateMarkers) {
        const centerY = dateMk.y
        const week = weekMarkers.find(w => Math.abs(w.y - centerY) <= TOLERANCE * 2)

        // Chercher le plus grand n valide pour n pair et n impair séparément.
        // Propriété : si n est valide, n-2 l'est aussi (monotonie par parité).
        let bestEvenN = 0
        let bestOddN = 0

        for (let n = 2; n <= 40; n += 2) {
          const ys = expectedRowYs(centerY, n, halfSpacing, rowSpacing)
          if (ys.every(ey => pickRow(descRows, ey, TOLERANCE, claimedYs))) bestEvenN = n
          else break
        }
        for (let n = 1; n <= 40; n += 2) {
          const ys = expectedRowYs(centerY, n, halfSpacing, rowSpacing)
          if (ys.every(ey => pickRow(descRows, ey, TOLERANCE, claimedYs))) bestOddN = n
          else break
        }

        const bestN = Math.max(bestEvenN, bestOddN)
        if (bestN === 0) continue

        const dateText = dateMk.text.match(DATE_RE)?.[0] ?? dateMk.text
        const weekText = week?.text ?? null

        for (const ey of expectedRowYs(centerY, bestN, halfSpacing, rowSpacing)) {
          const found = pickRow(descRows, ey, TOLERANCE, claimedYs)
          if (!found) continue
          claimedYs.add(found.y)
          allRows.push({
            page: pageIndex + 1,
            dateText,
            weekText,
            description: found.text,
            bbox: [
              dateMk.x,
              Math.min(dateMk.y, found.y),
              found.x + found.w,
              Math.max(dateMk.y + dateMk.h, found.y + found.h),
            ],
          })
        }
      }

      totalClaimedRows += claimedYs.size
    }

    doc.destroy()

    if (allRows.length === 0) return { detected: false, confidence: 0, rows: [] }

    // Confidence = couverture réelle : lignes de description réclamées sur la
    // totalité des lignes description présentes dans les pages à entête planning.
    const confidence = totalDescRows > 0
      ? Math.round((totalClaimedRows / totalDescRows) * 100) / 100
      : 1.0
    return { detected: true, confidence, rows: allRows }

  } catch {
    return { detected: false, confidence: 0, rows: [] }
  }
}

export function formatStructuredTableContext(context: StructuredTableContext): string {
  if (!context.detected || context.rows.length === 0) return ''
  return context.rows.map((r) => `[page ${r.page}] ${r.dateText ?? ''} | ${r.weekText ?? ''} | ${r.description}`).join('\n')
}
