// Santé d'une action ouverte = pure fonction d'ancienneté (déterministe,
// anti-pointage). Module SANS dépendance serveur → importable côté client.
// 🔴 critique ≥ 14 j · 🟠 à surveiller 7–13 j · 🟢 en rythme < 7 j.

export type ActionHealth = 'critique' | 'surveiller' | 'rythme'

export function actionHealth(createdAtIso: string, nowMs: number = Date.now()): ActionHealth {
  const days = Math.floor((nowMs - new Date(createdAtIso).getTime()) / 86_400_000)
  if (days >= 14) return 'critique'
  if (days >= 7) return 'surveiller'
  return 'rythme'
}

export interface ActionNarration {
  text: string
  tone: 'bad' | 'warn' | 'muted'
}

/**
 * Transforme une couleur de santé en PHRASE (Vincent 2026-06-21). Raconte la
 * durée d'une action, à partir de la donnée déjà connue — zéro nouvelle table.
 *   « Ouverte depuis 143 j » · « Déclarée bloquée il y a 12 j » · « Déclarée
 *   faite il y a 3 j · à valider ». Répond à « pourquoi cette action est rouge ? ».
 * Pure, importable côté client.
 */
export function actionDurationNarration(
  input: {
    createdAt: string
    status: string
    extStatus?: 'done' | 'blocked' | null
    extAt?: string | null
  },
  nowMs: number = Date.now(),
): ActionNarration | null {
  if (input.status === 'done' || input.status === 'cancelled') return null
  const daysSince = (iso: string) => Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000))

  // Niveau 3 — un retour d'entreprise (QR) prime : il raconte la dernière évolution.
  if (input.extStatus === 'blocked' && input.extAt) {
    return { text: `Déclarée bloquée il y a ${daysSince(input.extAt)} j`, tone: 'bad' }
  }
  if (input.extStatus === 'done' && input.extAt) {
    return { text: `Déclarée faite il y a ${daysSince(input.extAt)} j · à valider`, tone: 'warn' }
  }

  // Niveau 1 — sinon, l'ancienneté d'ouverture, tonalité selon la santé.
  const d = daysSince(input.createdAt)
  const h = actionHealth(input.createdAt, nowMs)
  const tone = h === 'critique' ? 'bad' : h === 'surveiller' ? 'warn' : 'muted'
  return { text: `Ouverte depuis ${d} j`, tone }
}
