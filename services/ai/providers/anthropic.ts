import type { AIProvider, CompletionInput, CompletionOutput } from '../index'

export class AnthropicProvider implements AIProvider {
  name = 'anthropic' as const

  async complete(_input: CompletionInput): Promise<CompletionOutput> {
    throw new Error(
      'AnthropicProvider not yet implemented. Install @anthropic-ai/sdk, set ANTHROPIC_API_KEY, and replace this stub.'
    )
  }
}
