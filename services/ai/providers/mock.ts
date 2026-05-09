import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

/**
 * Provider mock : utilise un dispatcher basé sur le system prompt pour retourner
 * un objet structurellement valide. Utilisé en dev et démo (pas de coût IA).
 *
 * Le contenu spécifique par agent (lecteur_ao, memoire_technique, etc.) est
 * fourni dans les fixtures importées par les agents, pas ici. Ce mock retourne
 * juste le `parsed` qu'on lui passe via `userMessage` JSON, ou un fallback.
 */
export class MockProvider implements AIProvider {
  name = 'mock' as const

  async complete(input: CompletionInput): Promise<CompletionOutput> {
    // Convention : si le caller veut une réponse spécifique, il pose
    // input.userMessage = '__MOCK_FIXTURE__:<json>'
    let parsed: unknown = null
    const prefix = '__MOCK_FIXTURE__:'
    if (input.userMessage.startsWith(prefix)) {
      try {
        parsed = JSON.parse(input.userMessage.slice(prefix.length))
      } catch {
        parsed = null
      }
    }
    if (parsed === null) {
      parsed = { _mock: true, hint: 'Caller did not pass __MOCK_FIXTURE__:<json>; falling back.' }
    }

    // Simulate small latency
    await new Promise((r) => setTimeout(r, 50))

    return {
      text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
      parsed,
      tokens: { input: 100, output: 200 },
      model: 'mock-1',
      durationMs: 50,
    }
  }
}
