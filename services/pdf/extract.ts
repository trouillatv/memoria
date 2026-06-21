/**
 * Extraction texte depuis un Buffer PDF via `unpdf`.
 * Détecte les PDF scannés (texte vide ou trop court) et signale via le champ isLikelyScanned.
 *
 * SERVERLESS : `unpdf` embarque un build de pdfjs prévu pour Node/serverless — pas de
 * référence DOM au chargement (DOMMatrix…) ET pas de worker externe à résoudre
 * (`pdf.worker.mjs`). C'est ce qui faisait échouer `pdf-parse` sur Vercel.
 * Import DYNAMIQUE par prudence (la lib ne s'évalue qu'à l'appel).
 */

export interface ExtractResult {
  text: string
  pageCount: number
  charCount: number
  isLikelyScanned: boolean
}

export async function extractPdfText(buffer: Buffer): Promise<ExtractResult> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text: raw, totalPages } = await extractText(pdf, { mergePages: true })
  const text = (raw ?? '').trim()
  const pageCount = totalPages ?? 0
  const charCount = text.length
  const isLikelyScanned = charCount < 200 && pageCount >= 1
  return { text, pageCount, charCount, isLikelyScanned }
}

// OCR de secours pour PDF scannés — Gemini Vision (inline_data base64).
// Même priorité que les embeddings : Google uniquement, pas de fallback OpenAI.
// Tracking ai_usage : 1 entrée par appel OCR (volume très faible, coût élevé
// par appel — visibilité critique pour budget).
export async function extractWithGeminiOCR(buffer: Buffer): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not set')

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const base64 = buffer.toString('base64')

  const start = Date.now()
  let lastError: string | null = null
  let extractedText = ''

  try {
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

    if (!res.ok) {
      lastError = `Gemini OCR ${res.status}: ${await res.text()}`
      throw new Error(lastError)
    }
    const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
    extractedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    if (extractedText.length < 50) {
      lastError = 'Gemini OCR returned insufficient text'
      throw new Error(lastError)
    }
    return extractedText
  } finally {
    // Tracking ai_usage — import dynamique pour éviter le coupling
    // côté services/pdf (qui ne dépend pas d'IA en général).
    try {
      const { logAIUsageDirect } = await import('@/services/ai/tracking')
      void logAIUsageDirect({
        feature: 'ocr_pdf',
        userId: null,
        provider: 'gemini',
        model,
        inputTokens: Math.ceil(buffer.byteLength / 1024), // approx tokens via taille fichier (kB)
        outputTokens: Math.ceil(extractedText.length / 4),
        durationMs: Date.now() - start,
        status: lastError ? 'error' : 'success',
        errorMsg: lastError,
      }).catch(() => {})
    } catch {
      /* silencieux : OCR doit marcher même si tracking échoue */
    }
  }
}
