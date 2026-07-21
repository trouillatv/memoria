// LA PROTECTION DES CORRECTIONS HUMAINES (Vincent, 2026-07-21).
//
// « "get or create" ne doit jamais vouloir dire "get or overwrite". »
//
// Tout ce qui décide du sort d'un CR de visite déjà existant vit ICI, en pur :
// aucune base, aucun réseau, donc chaque règle est prouvable en test unitaire.
// La couche DB ne fait qu'obéir à ces décisions.
//
// La règle cardinale : une correction humaine ne peut JAMAIS être écrasée par
// une régénération IA ultérieure. En cas de doute — origine IA inconnue,
// document déjà validé, section absente — on protège l'humain, on ne devine pas.

import type { ReportDocumentSection } from '@/types/db'

/** Ce qu'il faut faire d'un document existant (ou de son absence). */
export type VisitCrDecision = { action: 'create' } | { action: 'reuse' }

/**
 * Décide entre créer et réutiliser. Un document EXISTANT est toujours réutilisé
 * tel quel, quel que soit son statut : brouillon corrigé, validé ou exporté.
 * Il n'y a aucun cas où cette fonction autorise à remplacer des sections.
 */
export function decideVisitCrDocument(existing: { status: string } | null): VisitCrDecision {
  return existing ? { action: 'reuse' } : { action: 'create' }
}

/**
 * Fige la proposition IA à côté du contenu, à la création. Idempotent : une
 * origine déjà posée n'est jamais réécrite — sinon la première correction
 * humaine deviendrait « la proposition » et « revenir à la proposition »
 * ramènerait au texte corrigé.
 */
export function withAiBaseline(sections: ReportDocumentSection[]): ReportDocumentSection[] {
  return sections.map((s) => (s.ai_content === undefined ? { ...s, ai_content: s.content } : { ...s }))
}

/**
 * « Revenir à la proposition » — SEULE la section ciblée retrouve le texte de
 * MemorIA. Les autres ne bougent pas, le tableau reçu n'est pas muté.
 * Une section sans origine IA connue (écrite entièrement à la main) n'est jamais
 * vidée : on ne restaure pas ce qu'on n'a pas.
 */
export function restoreSectionProposal(
  sections: ReportDocumentSection[],
  key: string,
): ReportDocumentSection[] {
  return sections.map((s) =>
    s.key === key && s.ai_content !== undefined ? { ...s, content: s.ai_content } : { ...s },
  )
}

/**
 * Un humain est-il déjà passé sur ce document ? Sert de garde-fou avant toute
 * régénération. Une section sans origine IA connue compte comme humaine : dans
 * le doute on protège.
 */
export function hasHumanEdits(sections: ReportDocumentSection[]): boolean {
  return sections.some((s) => s.ai_content === undefined || s.ai_content !== s.content)
}
