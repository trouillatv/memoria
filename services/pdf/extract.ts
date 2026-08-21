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
  // mergePages:false → texte PAGE PAR PAGE. On injecte des marqueurs « [[page N]] »
  // pour que le LLM cite la VRAIE page (sinon, sur texte fusionné, il devine — et une
  // page inventée est pire que pas de page : elle détruit la confiance au clic).
  const { text: rawPages, totalPages } = await extractText(pdf, { mergePages: false })
  const pages = (Array.isArray(rawPages) ? rawPages : [rawPages]) as string[]
  const text = pages.map((t, i) => `[[page ${i + 1}]]\n${(t ?? '').trim()}`).join('\n\n').trim()
  const charCount = pages.reduce((n, t) => n + (t?.length ?? 0), 0) // contenu réel, hors marqueurs
  const pageCount = totalPages ?? pages.length
  const isLikelyScanned = charCount < 200 && pageCount >= 1
  return { text, pageCount, charCount, isLikelyScanned }
}

// OCR de secours pour PDF scannés — Gemini Vision page par page (inline_data PNG).
// Chaque page est rendue en PNG via renderPdfPage, puis transcrite individuellement
// par Gemini Vision. Les transcriptions sont concaténées avec des balises [[page N]].
// Même priorité que les embeddings : Google uniquement, pas de fallback OpenAI.
// Tracking ai_usage : 1 entrée par appel OCR (volume très faible, coût élevé
// par appel — visibilité critique pour budget).
export async function extractWithGeminiOCR(buffer: Buffer): Promise<string> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not set')

  const model = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const OCR_PROMPT = 'Transcris intégralement le texte de cette page du document PDF. Préserve la mise en page et la structure. Réponds uniquement le texte transcrit, sans commentaires ni captions.'

  const start = Date.now()
  let lastError: string | null = null
  let extractedText = ''

  try {
    // Déterminer le nombre de pages
    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const pageCount = pdf.numPages as number

    const { renderPdfPage } = await import('./render-page')

    const pageTexts: string[] = []
    let pagesWithSubstantialText = 0

    for (let i = 0; i < pageCount; i++) {
      const rendered = await renderPdfPage(buffer, i, 2.0)
      if (!rendered) {
        // Page non-rendue : on insère un marqueur vide
        pageTexts.push(`[[page ${i + 1}]]\n`)
        continue
      }

      const base64 = rendered.buffer.toString('base64')

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: 'image/png', data: base64 } },
                { text: OCR_PROMPT },
              ],
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 4096 },
          }),
        },
      )

      let pageText = ''
      if (res.ok) {
        const data = (await res.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
        pageText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
      } else {
        const errBody = await res.text()
        console.error(JSON.stringify({ service: 'extractWithGeminiOCR', event: 'page_ocr_error', page: i + 1, status: res.status, body: errBody.slice(0, 200) }))
      }

      if (pageText.length >= 50) {
        pagesWithSubstantialText++
      }
      pageTexts.push(`[[page ${i + 1}]]\n${pageText}`)
    }

    extractedText = pageTexts.join('\n\n').trim()

    // Validation : au moins 50 % des pages doivent produire du texte substantiel
    const halfPages = Math.max(1, Math.ceil(pageCount / 2))
    if (pagesWithSubstantialText < halfPages && extractedText.length < 50) {
      lastError = `Gemini OCR returned insufficient text (${pagesWithSubstantialText}/${pageCount} pages substantial)`
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
