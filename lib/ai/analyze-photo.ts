import 'server-only'

// Analyse visuelle d'une photo d'anomalie via Gemini Vision.
// Doctrine V5 : révéler jamais générer — description factuelle de ce qui est
// visible, jamais d'évaluation ni de jugement sur les personnes.
// Déclenchement : uniquement sur photos liées à une anomalie (anomaly_id présent).
// Coût : ~$0.0001/photo — négligeable à cette échelle.

const VISION_MODEL = 'gemini-2.5-flash'

const PROMPT = `Tu regardes une photo prise par un agent de nettoyage pour documenter un problème rencontré sur site.

Décris en 1 à 2 phrases courtes ce que tu vois dans la photo. Sois factuel et précis. Décris uniquement ce qui est visible.

Règles absolues :
- Jamais de jugement sur les personnes ou les équipes.
- Jamais d'évaluation (grave, urgent, dangereux) — seulement la description.
- Si la photo est floue, sombre ou illisible, dis-le en une phrase.
- Réponds en français.`

export async function analyzeAnomalyPhoto(
  imageBuffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) return null

  try {
    const base64 = imageBuffer.toString('base64')

    const body = {
      contents: [
        {
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    )

    if (!resp.ok) return null

    const json = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    return text && text.length > 4 ? text : null
  } catch {
    return null
  }
}
