// V1.5 — Embeddings provider-agnostic (Vincent 2026-05-15).
//
// Doctrine V5.1.4 :
//   "L'IA est un révélateur du réel, pas un générateur de texte."
//   Les embeddings servent UNIQUEMENT à détecter les voisinages sémantiques
//   faibles (humidité ↔ moisissure, robinet ↔ fuite) — jamais à générer
//   du texte. Ne PAS confondre avec un LLM.
//
// Priorité provider (premier clé définie gagne) :
//   1. GOOGLE_GENAI_API_KEY → text-embedding-004 (768 dim, gratuit tier dev)
//   2. OPENAI_API_KEY       → text-embedding-3-small (1536 dim)
//   3. VOYAGE_API_KEY       → voyage-3 (768 dim)
//   Si aucune clé → getEmbedding retourne null (fallback V1 token overlap).
//
// IMPORTANT : le schéma DB (trace_embeddings.embedding) doit correspondre
// aux dims du provider actif. Migration 053 règle ça pour Google (768 dim).

const GOOGLE_MODEL = 'gemini-embedding-2'   // 768 dim (outputDimensionality=768)
const OPENAI_MODEL = 'text-embedding-3-small' // 1536 dim
const VOYAGE_MODEL = 'voyage-3'              // 768 dim

export type EmbeddingProvider = 'google' | 'openai' | 'voyage' | null

export function getActiveProvider(): EmbeddingProvider {
  if (process.env.GOOGLE_GENAI_API_KEY) return 'google'
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.VOYAGE_API_KEY) return 'voyage'
  return null
}

/**
 * Calcule l'embedding d'un texte. Retourne null si :
 *   - aucune clé API n'est définie (mode V1 fallback)
 *   - le texte est vide ou < 4 caractères
 *   - l'API échoue (silencieux — l'IA se tait plutôt que d'écrire faux)
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  const trimmed = (text ?? '').trim()
  if (trimmed.length < 4) return null

  const provider = getActiveProvider()
  if (provider === null) return null

  try {
    if (provider === 'google') return await getEmbeddingGoogle(trimmed)
    if (provider === 'openai') return await getEmbeddingOpenAI(trimmed)
    if (provider === 'voyage') return await getEmbeddingVoyage(trimmed)
  } catch (e) {
    console.error('[embeddings]', provider, e)
    return null
  }
  return null
}

/**
 * Calcule en batch — utile pour le backfill. Préserve l'ordre.
 * Retourne (number[] | null)[] de même longueur que texts.
 */
export async function getEmbeddingsBatch(
  texts: string[],
): Promise<(number[] | null)[]> {
  const provider = getActiveProvider()
  if (provider === null) return texts.map(() => null)

  const results: (number[] | null)[] = []
  for (const t of texts) {
    results.push(await getEmbedding(t))
  }
  return results
}

// ---------------------------------------------------------------------------
// Google Gemini (text-embedding-004 — 768 dim, gratuit tier dev)
// ---------------------------------------------------------------------------

async function getEmbeddingGoogle(text: string): Promise<number[] | null> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) return null

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GOOGLE_MODEL}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${GOOGLE_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    },
  )

  if (!res.ok) {
    console.error('[embeddings/google]', res.status, await res.text())
    return null
  }

  const data = (await res.json()) as { embedding: { values: number[] } }
  return data.embedding?.values ?? null
}

// ---------------------------------------------------------------------------
// OpenAI (text-embedding-3-small — 1536 dim, fallback si OPENAI_API_KEY définie)
// ---------------------------------------------------------------------------

async function getEmbeddingOpenAI(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: text,
      encoding_format: 'float',
    }),
  })

  if (!res.ok) {
    console.error('[embeddings/openai]', res.status, await res.text())
    return null
  }

  const data = (await res.json()) as {
    data: Array<{ embedding: number[] }>
  }
  return data.data[0]?.embedding ?? null
}

// ---------------------------------------------------------------------------
// Voyage AI (voyage-3 — 768 dim, fallback si VOYAGE_API_KEY définie)
// ---------------------------------------------------------------------------

async function getEmbeddingVoyage(text: string): Promise<number[] | null> {
  const apiKey = process.env.VOYAGE_API_KEY
  if (!apiKey) return null

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: text,
      input_type: 'document',
    }),
  })

  if (!res.ok) {
    console.error('[embeddings/voyage]', res.status, await res.text())
    return null
  }

  const data = (await res.json()) as {
    data: Array<{ embedding: number[] }>
  }
  return data.data[0]?.embedding ?? null
}
