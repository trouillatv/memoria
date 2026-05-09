/**
 * Extraction texte depuis un Buffer PDF via pdf-parse v2 (PDFParse class API).
 * Détecte les PDF scannés (texte vide ou trop court) et signale via le champ isLikelyScanned.
 */

import { PDFParse } from 'pdf-parse'

export interface ExtractResult {
  text: string
  pageCount: number
  charCount: number
  isLikelyScanned: boolean
}

export async function extractPdfText(buffer: Buffer): Promise<ExtractResult> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    const text = (result.text ?? '').trim()
    const pageCount = result.total ?? result.pages?.length ?? 0
    const charCount = text.length
    const isLikelyScanned = charCount < 200 && pageCount >= 1
    return { text, pageCount, charCount, isLikelyScanned }
  } finally {
    await parser.destroy()
  }
}
