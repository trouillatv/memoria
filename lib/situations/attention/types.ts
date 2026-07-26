import type { PromiseSubjectRef } from '@/lib/memory/signals/operational-contract'
import type { SituationResolutionKind } from '../situation'

export type AttentionTone = 'neutral' | 'amber' | 'red'
export type AttentionIcon = 'calendar' | 'question' | 'document' | 'warning'

/** Un geste-LIEN de la carte (aujourd'hui : « Voir la source »). Les gestes de
 *  MUTATION ne passent pas par ici — ils vivent dans `resolutions` + `subject`. */
export type AttentionAction = {
  kind: 'open_source'
  label: string
  href: string
}

/** Un geste de RÉSOLUTION disponible sur la carte : libellé issu du presenter
 *  (source unique), déclenché avec le `subject` de la carte. */
export type AttentionResolution = {
  kind: SituationResolutionKind
  label: string
}

export type AttentionCard = {
  id: string
  icon: AttentionIcon
  tone: AttentionTone
  title: string
  description: string | null
  siteLabel: string
  organizationLabel?: string
  timingLabel?: string
  sourceLabel?: string
  primaryAction?: AttentionAction
  secondaryActions: AttentionAction[]
  /** Objet persistant à muter (T2) — présent seulement si la carte est résoluble. */
  subject: PromiseSubjectRef | null
  /** Gestes de résolution disponibles (T4) — vide si la carte n'est pas résoluble. */
  resolutions: AttentionResolution[]
}
