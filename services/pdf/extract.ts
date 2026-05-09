/**
 * Extraction texte depuis un Buffer PDF via pdf-parse.
 * Détecte les PDF scannés (texte vide ou trop court) et signale via le champ isLikelyScanned.
 */

import pdfParse from 'pdf-parse'

export interface ExtractResult {
  text: string
  pageCount: number
  charCount: number
  isLikelyScanned: boolean
}

export async function extractPdfText(buffer: Buffer): Promise<ExtractResult> {
  const result = await pdfParse(buffer)
  const text = (result.text ?? '').trim()
  const pageCount = result.numpages ?? 0
  const charCount = text.length
  const isLikelyScanned = charCount < 200 && pageCount >= 1
  return { text, pageCount, charCount, isLikelyScanned }
}
