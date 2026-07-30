import 'server-only'

// Génère une légende courte et spécifique pour une photo extraite d'un PV de chantier,
// en s'appuyant sur le texte de la page adjacente à l'image.
// Fallback silencieux : retourne null si la clé API est absente ou si l'appel échoue.

export async function generateImageCaption(
  pageText: string,
  model?: string,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey || !pageText.trim()) return null

  const prompt = `Tu es assistant technique en chantier de construction.
Le texte suivant provient de la page d'un PV de visite qui contient une ou plusieurs photos.

Génère une légende factuelle de 5 à 10 mots pour cette photo.
La légende doit décrire le sujet concret visible (élément de chantier, travaux, état d'avancement).
N'utilise pas de formule générique comme "Vue générale du chantier".
Commence par un nom (ex : "Fossé GDE réalisé", "Plateforme après nivellement", "Accès Est après reprise").
Réponds avec la légende uniquement, sans guillemets ni ponctuation finale.

Texte de la page :
${pageText.slice(0, 1500)}`

  try {
    const resolvedModel = model ?? process.env.AI_MODEL ?? 'gemini-2.5-flash'
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
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
