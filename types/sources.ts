import type { ChatAgentName } from './db'

export type SourceType = 'pdf' | 'library' | 'analysis'

export interface Source {
  type: SourceType
  quote: string                    // verbatim, max 500 chars (UI tronque à ~200)
  /**
   * La PIÈCE d'où vient la citation — « CCTP — cctp.pdf ».
   *
   * Depuis que l'analyse lit TOUT le dossier d'un coup (RC + CCAP + CCTP + BPU…),
   * le corpus concatène les pièces et CHACUNE redémarre à [[page 1]]. « Page 7 »
   * ne veut donc plus rien dire tout seul : il en existe une par pièce.
   *
   * Posé côté serveur, JAMAIS deviné par l'agent : on retrouve la pièce en
   * cherchant la citation dans chacune d'elles.
   */
  document?: string
  page?: number                    // numéro DANS la pièce — déterminé côté serveur
  library_item_id?: string         // uuid, posé après validation server-side
  library_item_title?: string      // remonté par l'agent
  library_item_category?: string   // posé après validation server-side
  reasoning?: string               // 1 phrase courte « pourquoi c'est pertinent », max 200 chars
  verified?: boolean               // false = match approximatif (warning UI)
  // L'agent qui a cité (utile pour debugging cross-agents — optionnel)
  cited_by?: ChatAgentName
}
