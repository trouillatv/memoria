import type { ChatAgentName } from './db'

export type SourceType = 'pdf' | 'library' | 'analysis'

export interface Source {
  type: SourceType
  quote: string                    // verbatim, max 500 chars (UI tronque à ~200)
  page?: number                    // si type='pdf' — agent peut deviner ou laisser vide
  library_item_id?: string         // uuid, posé après validation server-side
  library_item_title?: string      // remonté par l'agent
  library_item_category?: string   // posé après validation server-side
  reasoning?: string               // 1 phrase courte « pourquoi c'est pertinent », max 200 chars
  verified?: boolean               // false = match approximatif (warning UI)
  // L'agent qui a cité (utile pour debugging cross-agents — optionnel)
  cited_by?: ChatAgentName
}
