// N3.1 — PROMOUVOIR UNE PREUVE : CRÉER DE LA PROVENANCE (Vincent, 2026-07-22).
//
// « Ce n'est pas une fonctionnalité d'édition. C'est une création de provenance. »
//
// Les sections du compte-rendu naissent de l'analyse du CORPUS ENTIER. Elles ne
// savent donc nommer aucune capture, et deux questions restent sans réponse :
//
//   « Quelle capture exacte a produit cette phrase ? »
//   « Pourquoi cette phrase de mon vocal n'est-elle PAS dans le compte-rendu ? »
//
// Promouvoir une phrase depuis une preuve crée le maillon manquant — et sans la
// moindre inférence, puisque c'est l'humain qui le désigne en cliquant. La
// chaîne passe de trois maillons à quatre :
//
//   capture → phrase promue → ligne du compte-rendu → objet du chantier
//
// Ce module est PUR. Il ne rédige pas : il AJOUTE une ligne et inscrit d'où elle
// vient. Le texte existant n'est jamais réécrit — promouvoir n'est pas corriger.

import type { ReportDocumentSection, SectionPromotion } from '@/types/db'

export interface PromotionRequest {
  sectionKey: string
  /** La phrase, telle qu'elle a été prononcée ou écrite. On ne la reformule pas. */
  text: string
  captureId: string
  captureKind: string
  capturedAt: string
  promotedAt: string
  promotedBy: string | null
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Une phrase déjà promue dans cette section ? On ne l'ajoute pas deux fois. */
export function alreadyPromoted(section: ReportDocumentSection | undefined, text: string): boolean {
  if (!section) return false
  const wanted = norm(text)
  if ((section.promotions ?? []).some((p) => norm(p.text) === wanted)) return true
  // Elle peut aussi être déjà DANS le texte sans être passée par la promotion
  // (l'analyse l'avait proposée). Dans ce cas on n'ajoute rien non plus.
  return (section.content ?? '')
    .split('\n')
    .some((line) => norm(line.replace(/^[-•]\s*/, '')) === wanted)
}

/**
 * Ajoute la phrase à sa section et inscrit sa provenance.
 *
 * Le résumé est un PARAGRAPHE : la phrase s'y ajoute à la suite. Les autres
 * sections sont des listes : la phrase devient une puce. On respecte la forme
 * de la section plutôt que d'imposer la nôtre.
 */
export function promoteIntoSection(
  sections: ReportDocumentSection[],
  request: PromotionRequest,
): { sections: ReportDocumentSection[]; added: boolean } {
  const target = sections.find((s) => s.key === request.sectionKey)
  if (!target) return { sections, added: false }
  const text = request.text.trim()
  if (!text) return { sections, added: false }
  if (alreadyPromoted(target, text)) return { sections, added: false }

  const entry: SectionPromotion = {
    text,
    capture_id: request.captureId,
    capture_kind: request.captureKind,
    captured_at: request.capturedAt,
    promoted_at: request.promotedAt,
    promoted_by: request.promotedBy,
  }

  const next = sections.map((s) => {
    if (s.key !== request.sectionKey) return { ...s }
    const current = (s.content ?? '').trim()
    const asProse = s.key === 'resume'
    const line = asProse ? text : `- ${text}`
    return {
      ...s,
      content: current ? `${current}\n${line}` : line,
      promotions: [...(s.promotions ?? []), entry],
    }
  })
  return { sections: next, added: true }
}

/**
 * D'où vient cette ligne du compte-rendu ?
 *
 * `null` n'est pas un échec : c'est la réponse honnête pour une ligne née de
 * l'analyse du corpus. On ne devine pas une capture par ressemblance — ce
 * serait fabriquer la preuve qu'on prétend fournir.
 */
export function traceLine(
  section: ReportDocumentSection | undefined,
  text: string,
): SectionPromotion | null {
  if (!section) return null
  const wanted = norm(text)
  return (section.promotions ?? []).find((p) => norm(p.text) === wanted) ?? null
}

/**
 * La preuve derrière une ligne DU REGISTRE de concrétisation.
 *
 * Le registre n'inscrit pas la ligne, il inscrit son LIBELLÉ — et la lecture
 * d'une ligne opérationnelle coupe au tiret cadratin pour isoler responsable et
 * échéance. Une phrase promue contenant « — » perdait donc sa preuve, alors que
 * le lien existait : trouvé en préparant la démonstration, pas en relisant.
 *
 * On repasse donc par l'INDEX porté par `item_key` (`kind:index`), qui désigne
 * la ligne exacte. Aucune ressemblance de texte n'est tentée : si l'index ne
 * mène nulle part, la réponse reste null.
 */
export function traceRegistryLine(
  section: ReportDocumentSection | undefined,
  itemKey: string | undefined,
  label: string,
): SectionPromotion | null {
  if (!section) return null
  const direct = traceLine(section, label)
  if (direct) return direct
  const index = Number(itemKey?.split(':').pop())
  if (!Number.isInteger(index) || index < 0) return null
  const line = bulletsOf(section.content ?? '')[index]
  return line ? traceLine(section, line) : null
}

/** Les lignes d'une section, sans leur puce. Même lecture que la
 *  concrétisation : les deux DOIVENT numéroter les lignes à l'identique. */
export function bulletsOf(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
}

/** Les phrases d'une preuve qui ne sont PAS entrées dans le compte-rendu.
 *  L'inverse de la question habituelle, et personne ne sait y répondre. */
export function notPromotedFrom(
  sections: ReportDocumentSection[],
  captureId: string,
  candidates: string[],
): string[] {
  const promoted = new Set(
    sections.flatMap((s) => (s.promotions ?? []).filter((p) => p.capture_id === captureId)).map((p) => norm(p.text)),
  )
  return candidates.filter((c) => c.trim() && !promoted.has(norm(c)))
}
