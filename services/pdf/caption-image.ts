import 'server-only'

// Lit la légende IMPRIMÉE dans/sous une image extraite d'un PV de chantier.
// Approche documentaire : Vision transcrit ce qui est visible, ne génère rien.
// document_caption = null si aucune légende lisible n'est présente dans l'image.
// Le snapshot de page (si disponible) permet d'établir le contexte de position.
//
// Diagnostic : activer CAPTION_DIAG=1 pour loguer (stderr) le chemin de chaque appel.

export interface CaptionResult {
  document_caption: string | null    // légende telle qu'imprimée ; null si absente
  visual_description: string         // description courte (5-15 mots) du contenu visuel
  association_confidence: 'high' | 'medium' | 'low'
  is_decorative: boolean | null      // true = logo/bandeau ; false = photo de chantier
}

function diag(event: string, pageNum: number, extra?: Record<string, unknown>) {
  if (process.env.CAPTION_DIAG !== '1') return
  console.error(JSON.stringify({ readImageCaption: 'DIAG', event, pageNum, ...extra }))
}

export async function readImageCaption(
  cropBuffer: Buffer,
  pageSnapshot: Buffer | null,
  normalizedBbox: [number, number, number, number],
  pageNum: number,
  pageText: string,
  model?: string,
): Promise<CaptionResult | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) {
    diag('no_api_key', pageNum)
    return null
  }

  const hasSnapshot = pageSnapshot !== null
  const bboxStr = normalizedBbox.map((v) => v.toFixed(3)).join(', ')

  const prompt = `Tu es un assistant technique de chantier de construction. Tu analyses une image extraite d'un PV de visite.

IMAGE FOURNIE : le recadrage de l'image${hasSnapshot ? ` + la page complète (pour localiser l'image dans son contexte)` : ''}.

TÂCHE 1 — document_caption : lis et transcris mot pour mot la légende ou le titre IMPRIMÉ dans ou directement sous cette image dans le document.
- S'il n'y a PAS de texte de légende clairement lisible → retourne null.
- INTERDIT : inventer, déduire, paraphraser ou générer. Transcris uniquement ce qui est imprimé.
- Conserver les abréviations, la ponctuation et la casse d'origine.

TÂCHE 2 — visual_description : décris en 5 à 15 mots ce que tu vois dans l'image (contenu visuel, pas la légende).

TÂCHE 3 — association_confidence :
${hasSnapshot ? '- "high" si tu vois clairement où cette image se trouve sur la page complète et que la légende est certaine' : '- "low" car aucune page complète n\'est disponible pour confirmer la position'}
- "medium" si tu as un contexte partiel
- "low" si la position ou le contenu est ambigu

TÂCHE 4 — is_decorative : true si logo/bandeau/filigrane/décoration, false si photo de chantier, null si incertain.

CONTEXTE DOCUMENT :
- Page ${pageNum}
- Position dans la page (bbox normalisée [x0,y0,x1,y1] en proportion) : [${bboxStr}]
- Texte de la page : ${pageText.slice(0, 600)}`

  try {
    const resolvedModel = model ?? process.env.AI_MODEL ?? 'gemini-2.5-flash'
    const cropBase64 = cropBuffer.toString('base64')

    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
      { text: prompt },
      { inline_data: { mime_type: 'image/png', data: cropBase64 } },
    ]
    if (pageSnapshot) {
      parts.push({ inline_data: { mime_type: 'image/png', data: pageSnapshot.toString('base64') } })
    }

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        document_caption: { type: 'STRING', nullable: true },
        visual_description: { type: 'STRING' },
        association_confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        is_decorative: { type: 'BOOLEAN', nullable: true },
      },
      required: ['document_caption', 'visual_description', 'association_confidence', 'is_decorative'],
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            // 1024 : budget suffisant pour JSON + description ; thinking désactivé ci-dessous
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema,
            // Gemini 2.5 Flash active le thinking par défaut ; cela consomme des output tokens
            // avant même de produire le JSON, épuisant les 256 anciens tokens sur 7/8 appels.
            // thinkingBudget=0 désactive le thinking pour un JSON structuré rapide et prévisible.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    )

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>')
      diag('http_error', pageNum, { status: res.status, body: body.slice(0, 600) })
      return null
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
        finishReason?: string
      }>
      promptFeedback?: { blockReason?: string }
    }

    if (!data.candidates || data.candidates.length === 0) {
      diag('no_candidates', pageNum, {
        promptFeedback: data.promptFeedback ?? null,
        rawKeys: Object.keys(data),
      })
      return null
    }

    const candidate = data.candidates[0]

    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      diag('non_stop_finish', pageNum, { finishReason: candidate.finishReason })
      if (candidate.finishReason === 'MAX_TOKENS') return null
      if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') return null
    }

    const raw = candidate.content?.parts?.[0]?.text?.trim()
    if (!raw) {
      diag('empty_text', pageNum, { finishReason: candidate.finishReason ?? null })
      return null
    }

    let parsed: CaptionResult
    try {
      parsed = JSON.parse(raw) as CaptionResult
    } catch (parseErr) {
      diag('json_parse_error', pageNum, { raw: raw.slice(0, 300), error: String(parseErr) })
      return null
    }

    const outcome = parsed.document_caption !== null ? 'success_with_caption' : 'success_null_caption'
    diag(outcome, pageNum, {
      document_caption: parsed.document_caption,
      association_confidence: parsed.association_confidence,
      is_decorative: parsed.is_decorative,
    })
    return parsed
  } catch (e) {
    diag('exception', pageNum, { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}
