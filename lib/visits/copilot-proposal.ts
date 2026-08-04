// Copilote 3C — types et builder déterministe de propositions.
//
// Principe : le classifieur détecte une intention d'écriture et résout le sujet.
// Ce module construit le brouillon affiché à l'utilisateur.
// AUCUNE écriture DB ici — le brouillon est éditable avant confirmation humaine.

export type CopilotProposalKind = 'action' | 'visit_item'

export type CopilotConfidence = 'strong' | 'medium' | 'suggestion'

export type CopilotProposal = {
  proposalId: string
  kind: CopilotProposalKind
  title: string
  body: string | null
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
  confidence: CopilotConfidence
  whyText: string
  llmModel: string
  promptVersion: string
}

export const COPILOT_PROMPT_VERSION = '3c-v1'
export const COPILOT_LLM_MODEL = 'classifier-deterministic'

// Signaux indiquant que la demande concerne le plan de visite plutôt qu'une action
const VISIT_ITEM_SIGNALS = [
  /\bpr[eé]parer\b/i,
  /\bprochaine\s+visite\b/i,
  /\bv[eé]rifier\b/i,
  /\bplan\s+(de\s+)?visite\b/i,
  /\bpoint[s]?\s+[àa]\s+voir\b/i,
  /\bajoute[rz]?\s+(?:au\s+)?plan\b/i,
  /\bmets?\s+en\s+plan\b/i,
]

function detectKind(question: string): CopilotProposalKind {
  return VISIT_ITEM_SIGNALS.some((r) => r.test(question)) ? 'visit_item' : 'action'
}

function buildTitle(question: string, kind: CopilotProposalKind, subjectLabel: string | null): string {
  if (kind === 'visit_item' && subjectLabel) {
    return `Vérifier : ${subjectLabel}`
  }
  // Retirer le verbe d'action en début de question pour ne garder l'essentiel
  const clean = question
    .trim()
    .replace(/^(cr[eé]e[rz]?|ajoute[rz]?|planifie[rz]?|note[rz]?|programme[rz]?|mets?\s+en\s+plan)\s+/i, '')
    .replace(/^(une?\s+|l[ae]\s+)/i, '')
  const clipped = clean.length > 90 ? clean.slice(0, 87) + '…' : clean
  const label = clipped.charAt(0).toUpperCase() + clipped.slice(1)
  return label || (kind === 'visit_item' ? 'Point à vérifier' : 'Nouvelle action')
}

function buildWhyText(kind: CopilotProposalKind, subjectLabel: string | null): string {
  const subject = subjectLabel
    ? `Associé au sujet « ${subjectLabel} ».`
    : "Aucun sujet canonique identifié — vous pouvez l'associer manuellement après création."
  const ctx = kind === 'visit_item'
    ? ' Sera ajouté à votre plan de prochaine visite.'
    : ' Deviendra une action ouverte sur ce chantier.'
  return subject + ctx
}

export function buildCopilotProposal(params: {
  question: string
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
  resolvedWithConfidence: boolean
}): CopilotProposal {
  const { question, canonicalSubjectId, canonicalSubjectLabel, resolvedWithConfidence } = params

  const kind = detectKind(question)
  const title = buildTitle(question, kind, canonicalSubjectLabel)
  const whyText = buildWhyText(kind, canonicalSubjectLabel)

  const confidence: CopilotConfidence = resolvedWithConfidence
    ? 'strong'
    : canonicalSubjectId
    ? 'medium'
    : 'suggestion'

  return {
    proposalId: crypto.randomUUID(),
    kind,
    title,
    body: null,
    canonicalSubjectId,
    canonicalSubjectLabel,
    confidence,
    whyText,
    llmModel: COPILOT_LLM_MODEL,
    promptVersion: COPILOT_PROMPT_VERSION,
  }
}
