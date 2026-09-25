import type { EngagementLinkQualification } from '@/types/db'

// P0-4C — les 4 qualifications humaines du POURQUOI d'un lien Action ↔
// Engagement. Jamais une conformité : répond à « pourquoi cette Action
// concerne cet Engagement », jamais à « est-ce respecté ? ». Source unique
// des libellés, partagée par ActionFicheEngagementCta et « Traiter un point »
// — aucune nouvelle taxonomie ne doit être ajoutée ici sans nouveau GO.
export const QUALIFICATION_OPTIONS: Array<{ value: EngagementLinkQualification; label: string }> = [
  { value: 'demande_evolution', label: "Demande d'évolution" },
  { value: 'mise_en_oeuvre', label: 'Mise en œuvre' },
  { value: 'ecart_a_examiner', label: 'Écart à examiner' },
  { value: 'clarification', label: 'À clarifier' },
]

export const QUALIFICATION_LABEL: Record<string, string> = Object.fromEntries(
  QUALIFICATION_OPTIONS.map((o) => [o.value, o.label]),
)
