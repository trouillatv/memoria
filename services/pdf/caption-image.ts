import 'server-only'

// Génère une légende courte pour une photo extraite d'un PV de chantier.
// Approche hybride : vision IA sur l'image + texte de la page comme contexte.
// La vision garantit que la légende décrit ce qui est réellement visible.
// Fallback silencieux : retourne null si la clé API est absente ou si l'appel échoue.

export async function generateImageCaption(
  imageBuffer: Buffer,
  pageText: string,
  model?: string,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) return null

  const prompt = `Tu es assistant technique en chantier de construction.
Cette image est extraite d'un PV de visite de chantier.

Génère une légende factuelle de 5 à 10 mots décrivant ce que tu vois RÉELLEMENT dans l'image.
Règles :
- Base-toi d'abord sur ce que tu vois (l'image prime sur le texte).
- Utilise le contexte textuel uniquement pour préciser (nom d'un ouvrage, localisation).
- Commence par un nom ou un groupe nominal : "Fossé GDE réalisé", "Plateforme après nivellement", "Talus en cours de terrassement".
- Interdit : "Vue générale", "Photo du chantier", formules vagues.
- Réponds avec la légende uniquement, sans guillemets ni ponctuation finale.

Contexte de la page (aide uniquement) :
${pageText.slice(0, 600)}`

  try {
    const resolvedModel = model ?? process.env.AI_MODEL ?? 'gemini-2.5-flash'
    const base64 = imageBuffer.toString('base64')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/png', data: base64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 32 },
        }),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null
    if (!raw || raw.length > 120) return null
    return raw
  } catch {
    return null
  }
}
