// SCÈNE « MATIN » — le matin on AGIT : l'irréversible avant tout (le retard se
// rattrape, la preuve recouverte jamais), puis l'actionnable daté, puis le
// structurel. Consommée par le digest nocturne → l'écran du Matin.
import type { SignalKind } from '@/lib/db/site-memory-signals'

export const MATIN: SignalKind[] = [
  'proof_window_closing',
  'action_overdue',
  'obligation_neglected',
  'decision_unapplied',
  'reserve_open',
  'actor_absent',
  'action_recurring',
  'actor_congestion',
  'recurring_topic',
]
