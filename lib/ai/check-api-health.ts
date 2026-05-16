import 'server-only'
import { unstable_cache } from 'next/cache'

export type ApiHealthStatus = 'ok' | 'no_key' | 'error'

export interface ApiHealth {
  provider: 'google' | 'openai' | 'voyage' | null
  status: ApiHealthStatus
  errorMsg?: string
  checkedAt: string
}

// Timeout court : le health check est informatif, pas critique.
// En dev mode le serveur est mono-threadé — un appel qui traîne bloque tout.
const HEALTH_CHECK_TIMEOUT_MS = 3000

async function _checkEmbeddingApiHealth(): Promise<ApiHealth> {
  const checkedAt = new Date().toISOString()

  if (process.env.GOOGLE_GENAI_API_KEY) {
    return checkGoogle(process.env.GOOGLE_GENAI_API_KEY, checkedAt)
  }
  if (process.env.OPENAI_API_KEY) {
    return checkOpenAI(process.env.OPENAI_API_KEY, checkedAt)
  }
  if (process.env.VOYAGE_API_KEY) {
    return checkVoyage(process.env.VOYAGE_API_KEY, checkedAt)
  }

  return { provider: null, status: 'no_key', checkedAt }
}

/**
 * Vérifie la santé de l'API embedding.
 * Résultat mis en cache 2 minutes — l'appel API réel ne tourne pas à chaque
 * chargement de /admin/monitoring (sinon bloque le serveur dev).
 */
export const checkEmbeddingApiHealth = unstable_cache(
  _checkEmbeddingApiHealth,
  ['embedding-api-health'],
  { revalidate: 120 },
)

async function checkGoogle(apiKey: string, checkedAt: string): Promise<ApiHealth> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-2',
          content: { parts: [{ text: 'ping' }] },
          outputDimensionality: 768,
        }),
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      const body = await res.text()
      return {
        provider: 'google',
        status: 'error',
        errorMsg: `HTTP ${res.status} — ${body.slice(0, 200)}`,
        checkedAt,
      }
    }
    return { provider: 'google', status: 'ok', checkedAt }
  } catch (e) {
    return {
      provider: 'google',
      status: 'error',
      errorMsg: e instanceof Error ? e.message : String(e),
      checkedAt,
    }
  }
}

async function checkOpenAI(apiKey: string, checkedAt: string): Promise<ApiHealth> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: 'ping' }),
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text()
      return {
        provider: 'openai',
        status: 'error',
        errorMsg: `HTTP ${res.status} — ${body.slice(0, 200)}`,
        checkedAt,
      }
    }
    return { provider: 'openai', status: 'ok', checkedAt }
  } catch (e) {
    return {
      provider: 'openai',
      status: 'error',
      errorMsg: e instanceof Error ? e.message : String(e),
      checkedAt,
    }
  }
}

async function checkVoyage(apiKey: string, checkedAt: string): Promise<ApiHealth> {
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'voyage-3', input: 'ping' }),
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text()
      return {
        provider: 'voyage',
        status: 'error',
        errorMsg: `HTTP ${res.status} — ${body.slice(0, 200)}`,
        checkedAt,
      }
    }
    return { provider: 'voyage', status: 'ok', checkedAt }
  } catch (e) {
    return {
      provider: 'voyage',
      status: 'error',
      errorMsg: e instanceof Error ? e.message : String(e),
      checkedAt,
    }
  }
}
