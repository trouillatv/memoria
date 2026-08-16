import { GoogleGenAI } from '@google/genai'
import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

function resolveModel(input: CompletionInput): string {
  const modelLight = process.env.AI_MODEL_LIGHT ?? 'gemini-2.5-flash'
  const modelHeavy = process.env.AI_MODEL_HEAVY ?? 'gemini-2.5-flash'
  return input.modelTier === 'heavy' ? modelHeavy : modelLight
}

// Config partagée par `complete` et `completeStream` : même modèle, même
// budget, même schéma. Le streaming n'est qu'un second transport du même
// appel, jamais une seconde décision de génération (D1, 2026-08-16).
function buildGenerateConfig(input: CompletionInput, abortSignal: AbortSignal) {
  return {
    systemInstruction: input.systemPrompt,
    temperature: 0.3,
    maxOutputTokens: input.maxOutputTokens ?? 1500,
    abortSignal,
    // On DÉSACTIVE le thinking de Gemini 2.5 (flash/pro) PARTOUT. Par défaut
    // le modèle « réfléchit » AVANT de répondre, et ces tokens de réflexion
    // se déduisent de maxOutputTokens : le budget est mangé avant l'émission
    // → texte tronqué en plein milieu (résumé de visite coupé, narratif du
    // débrief incomplet) ou JSON vide (parse échoue). Nos tâches ORGANISENT
    // un texte fourni, elles ne raisonnent pas en profondeur : tout le budget
    // doit aller à la SORTIE. (Auparavant le thinking n'était coupé que pour
    // le JSON — d'où la troncature silencieuse des sorties en texte libre.)
    thinkingConfig: { thinkingBudget: 0 },
    ...(input.responseSchema ? {
      responseMimeType: 'application/json',
      ...(input.geminiSchema ? { responseSchema: input.geminiSchema } : {}),
    } : {}),
  }
}

function parseJsonOutput(text: string, responseSchema: CompletionInput['responseSchema']): unknown {
  if (!responseSchema) return null
  // Strip défensif d'un éventuel fence ```json … ``` avant parse.
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

export class GeminiProvider implements AIProvider {
  name = 'gemini' as const

  async complete(input: CompletionInput): Promise<CompletionOutput> {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY non définie')

    const ai = new GoogleGenAI({ apiKey })
    const model = resolveModel(input)
    const start = Date.now()

    // Timeout DUR de 60 s par appel. Un appel Gemini bloqué (réseau, quota,
    // modèle lent) ne doit jamais figer l'analyse AO entière. On utilise un
    // AbortController explicite plutôt que httpOptions.timeout seul, car le SDK
    // ré-essaie les timeouts HTTP par défaut (cf. docs @google/genai) — le pire
    // cas dépasserait alors 60 s. Le signal coupe net, sans retry.
    const TIMEOUT_MS = 60_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let response
    try {
      response = await ai.models.generateContent({
        model,
        config: buildGenerateConfig(input, controller.signal),
        contents: input.userMessage,
      })
    } catch (e) {
      // Timeout → erreur explicite et exploitable. Sinon on propage l'erreur
      // Gemini telle quelle. Dans tous les cas l'erreur remonte au flux
      // d'analyse (orchestrator → after()) qui passe l'AO en `failed`.
      if (controller.signal.aborted) {
        throw new Error(`Gemini timeout après ${TIMEOUT_MS / 1000}s (modèle ${model})`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }

    const text = response.text ?? ''
    return {
      text,
      parsed: parseJsonOutput(text, input.responseSchema),
      tokens: {
        input: response.usageMetadata?.promptTokenCount ?? 0,
        output: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      model,
      durationMs: Date.now() - start,
      finishReason: response.candidates?.[0]?.finishReason ?? undefined,
    }
  }

  // D1 (2026-08-16) : même appel que `complete`, transport streaming. Émet
  // chaque delta de texte au fil de la génération et se termine avec le même
  // `CompletionOutput` — l'appelant qui ignore le streaming peut consommer le
  // retour du générateur exactement comme celui de `complete`.
  async *completeStream(input: CompletionInput): AsyncGenerator<string, CompletionOutput, void> {
    const apiKey = process.env.GOOGLE_GENAI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY non définie')

    const ai = new GoogleGenAI({ apiKey })
    const model = resolveModel(input)
    const start = Date.now()

    const TIMEOUT_MS = 60_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let acc = ''
    let tokensIn = 0
    let tokensOut = 0
    let finishReason: string | undefined
    try {
      const stream = await ai.models.generateContentStream({
        model,
        config: buildGenerateConfig(input, controller.signal),
        contents: input.userMessage,
      })
      for await (const chunk of stream) {
        const delta = chunk.text ?? ''
        if (delta) {
          acc += delta
          yield delta
        }
        if (chunk.usageMetadata?.promptTokenCount != null) tokensIn = chunk.usageMetadata.promptTokenCount
        if (chunk.usageMetadata?.candidatesTokenCount != null) tokensOut = chunk.usageMetadata.candidatesTokenCount
        const reason = chunk.candidates?.[0]?.finishReason
        if (reason) finishReason = reason
      }
    } catch (e) {
      if (controller.signal.aborted) {
        throw new Error(`Gemini timeout après ${TIMEOUT_MS / 1000}s (modèle ${model})`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }

    return {
      text: acc,
      parsed: parseJsonOutput(acc, input.responseSchema),
      tokens: { input: tokensIn, output: tokensOut },
      model,
      durationMs: Date.now() - start,
      finishReason,
    }
  }
}
