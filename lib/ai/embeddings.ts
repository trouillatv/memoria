// V1.5 — Embeddings provider-agnostic (Vincent 2026-05-15).
//
// Doctrine V5.1.4 :
//   "L'IA est un révélateur du réel, pas un générateur de texte."
//   Les embeddings servent UNIQUEMENT à détecter les voisinages sémantiques
//   faibles (humidité ↔ moisissure, robinet ↔ fuite) — jamais à générer
//   du texte. Ne PAS confondre avec un LLM.
//
// Activation :
//   - Définir OPENAI_API_KEY → utilise OpenAI text-embedding-3-small
//   - OU définir VOYAGE_API_KEY → utilise Voyage AI voyage-3
//   - Si AUCUNE des deux n'est définie, getEmbedding retourne null
//     (le code applicatif fallback automatiquement sur V1 token overlap).
//
// Coût pilote AGP : négligeable (~0.001$/mois). À scale 1000 sites ~0.20$/mois.

const OPENAI_MODEL = 'text-embedding-3-small'  // 1536 dim
const VOYAGE_MODEL = 'voyage-3'                // dim natif 1024 — output_dimension=1536 pour cohérence

export type EmbeddingProvider = 'openai' | 'voyage' | null

export function getActiveProvider(): EmbeddingProvider {
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

  // Pour V1.5 simple : appels séquentiels avec throttle minimal. Les deux APIs
  // supportent un batch endpoint qu'on pourra exploiter en V2.
  const results: (number[] | null)[] = []
  for (const t of texts) {
    results.push(await getEmbedding(t))
  }
  return results
}

// ---------------------------------------------------------------------------
// OpenAI
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
// Voyage AI (partenaire embeddings recommandé par Anthropic)
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
      input_type: 'document',  // pour le stockage (vs 'query' pour la recherche)
      output_dimension: 1536,  // pad à 1536 pour cohérence avec OpenAI
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
