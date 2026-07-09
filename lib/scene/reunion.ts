// SCÈNE « RÉUNION » — en réunion on ANIME : l'irréversible d'abord quand même,
// puis « de quoi cette réunion va parler » (concentration d'acteur), puis ce
// qui traîne. Consommée par buildSiteMemorySignals (briefing, recap, prépa).
import type { SignalKind } from '@/lib/db/site-memory-signals'

export const REUNION: SignalKind[] = [
  'proof_window_closing',
  'actor_congestion',
  'obligation_neglected',
  'action_overdue',
  'action_recurring',
  'decision_unapplied',
  'actor_absent',
  'reserve_open',
  'recurring_topic',
]
