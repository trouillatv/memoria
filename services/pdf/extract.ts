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

// OCR de secours pour PDF scannés — Gemini Vision (inline_data base64).
// Même priorité que les embeddings : Google uniquement, pas de fallback OpenAI.
export async function extractWithGeminiOCR(buffer: Buffer): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not set')

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.0-flash'
  const base64 = buffer.toString('base64')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: 'application/pdf', data: base64 } },
            { text: 'Extrais tout le texte de ce document PDF scanné. Retourne uniquement le texte brut, sans mise en forme ni explication.' },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 8000 },
      }),
    },
  )

  if (!res.ok) throw new Error(`Gemini OCR ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
  if (text.length < 50) throw new Error('Gemini OCR returned insufficient text')
  return text
}
