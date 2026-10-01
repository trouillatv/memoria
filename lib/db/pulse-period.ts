// Constantes de période du Pulse global /equipes, extraites de team-pulse.ts
// (qui importe 'server-only') pour rester importables depuis un Client
// Component (PulsePeriodSelect.tsx) sans entraîner tout le module serveur
// dans le bundle navigateur.

export const PULSE_PERIOD_VALUES = ['7', '30', '90'] as const
export type PulsePeriod = (typeof PULSE_PERIOD_VALUES)[number]
export const DEFAULT_PULSE_PERIOD: PulsePeriod = '30'

export function parsePulsePeriod(raw: string | undefined): PulsePeriod {
  return (PULSE_PERIOD_VALUES as readonly string[]).includes(raw ?? '')
    ? (raw as PulsePeriod)
    : DEFAULT_PULSE_PERIOD
}
