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
