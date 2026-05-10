import type { ChatAgentName } from '@/types/db'
import { MAX_AGENTS } from './copilote-mode'

const VALID_AGENTS: readonly ChatAgentName[] = [
  'general', 'lecteur_ao', 'memoire_technique',
  'contradicteur', 'financier', 'terrain', 'conformite',
] as const

function storageKey(tenderId: string): string {
  return `copilote-agents-${tenderId}`
}

export function loadSelectedAgents(tenderId: string): ChatAgentName[] {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(storageKey(tenderId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((a): a is ChatAgentName => typeof a === 'string' && (VALID_AGENTS as readonly string[]).includes(a))
      .slice(0, MAX_AGENTS)
  } catch {
    return []
  }
}

export function saveSelectedAgents(tenderId: string, agents: ChatAgentName[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey(tenderId), JSON.stringify(agents.slice(0, MAX_AGENTS)))
}
