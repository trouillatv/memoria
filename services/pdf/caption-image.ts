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

Génère une légende de 4 à 12 mots, CONTEXTUALISÉE au chantier et à la situation réelle.

Règles de priorité :
1. Si le texte de la page nomme un ouvrage, une zone ou un lot (ex : "GDE", "Accès Est", "assainissement"), utilise ce nom en premier.
2. Si le texte mentionne un statut ("réalisé", "terminé", "en cours"), ajoute-le.
3. Décris ce que tu vois dans un vocabulaire de chantier : terrassement, remblai, tranchée, talus, plateforme, berge, drainage, etc.
4. Évite les généralités sans précision : pas de "Vue générale", "Photo du chantier", "Travaux en cours", "Chantier en cours".
5. Commence par le nom de l'ouvrage ou de la zone si disponible, sinon par le type de travaux.

Bons exemples : "Tranchée GDE réalisée", "Plateforme après nivellement", "Accès Est — remblais en cours", "Zone de prélèvement G3", "Talus après terrassement"
Mauvais exemples : "Tranch", "Vue de la plateforme", "Berge", "Photo du chantier"

Réponds avec la légende uniquement, sans guillemets ni ponctuation finale.

Contexte de la page (nom d'ouvrage, zone, statuts) :
${pageText.slice(0, 1200)}`

  try {
    const resolvedModel = model ?? process.env.AI_MODEL ?? 'gemini-2.5-flash'
    const base64 = imageBuffer.toString('base64')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/png', data: base64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 48 },
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
