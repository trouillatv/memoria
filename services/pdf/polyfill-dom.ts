// Polyfill DOM pour le runtime SERVERLESS (Vercel/Node) — import à effet de bord.
//
// `pdf-parse` (via `pdfjs-dist`) référence DOMMatrix / Path2D / ImageData au
// CHARGEMENT du module. Ces APIs n'existent pas côté serveur → « ReferenceError:
// DOMMatrix is not defined » et le module ne se charge même pas.
//
// Pour l'EXTRACTION DE TEXTE (pas de rendu canvas), pdfjs n'appelle pas réellement
// ces classes : il suffit qu'elles EXISTENT au chargement. On pose donc des stubs
// minimaux. Ce module doit être importé AVANT pdf-parse (cf. extract.ts).

const g = globalThis as unknown as Record<string, unknown>

if (typeof g.DOMMatrix === 'undefined') {
  class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    m11 = 1; m12 = 0; m13 = 0; m14 = 0
    m21 = 0; m22 = 1; m23 = 0; m24 = 0
    m31 = 0; m32 = 0; m33 = 1; m34 = 0
    m41 = 0; m42 = 0; m43 = 0; m44 = 1
    constructor(_init?: unknown) {}
    multiply() { return this }
    multiplySelf() { return this }
    preMultiplySelf() { return this }
    translate() { return this }
    translateSelf() { return this }
    scale() { return this }
    scaleSelf() { return this }
    rotate() { return this }
    rotateSelf() { return this }
    invertSelf() { return this }
    inverse() { return this }
    transformPoint(p?: unknown) { return p }
  }
  g.DOMMatrix = DOMMatrix
}

if (typeof g.Path2D === 'undefined') {
  class Path2D {
    constructor(_init?: unknown) {}
    addPath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    closePath() {}
    rect() {}
  }
  g.Path2D = Path2D
}

if (typeof g.ImageData === 'undefined') {
  class ImageData {
    width: number; height: number; data: Uint8ClampedArray
    constructor(w?: number, h?: number) {
      this.width = w ?? 0
      this.height = h ?? 0
      this.data = new Uint8ClampedArray((this.width * this.height) * 4)
    }
  }
  g.ImageData = ImageData
}

export {}
