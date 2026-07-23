// Gestion du mode bureau temporaire dans la PWA.
//
// La PWA est une interface terrain (destination par défaut : /m). L'utilisateur
// peut basculer sur le bureau pour une tâche ponctuelle — ce choix est valide
// 15 minutes et expire silencieusement. À chaque navigation côté dashboard,
// l'expiration est repoussée (fenêtre glissante). Quand la fenêtre expire,
// la prochaine ouverture de la PWA revient automatiquement sur /m.
//
// Stockage :
//   localStorage `memoria:pwa-mode:<userId>`  → { mode, expiresAt }
//   cookie `pwa_standalone` = "1"              → lisible côté serveur (routing)

export const COOKIE_PWA_STANDALONE = 'pwa_standalone'

export const PWA_DESKTOP_TTL_MS = 15 * 60 * 1000 // 15 minutes

export interface PwaDesktopPreference {
  mode: 'desktop'
  expiresAt: string
}

export function pwaDesktopLsKey(userId: string): string {
  return `memoria:pwa-mode:${userId}`
}

export function readPwaDesktopPreference(userId: string): PwaDesktopPreference | null {
  try {
    const raw = localStorage.getItem(pwaDesktopLsKey(userId))
    if (!raw) return null
    return JSON.parse(raw) as PwaDesktopPreference
  } catch {
    return null
  }
}

export function isPwaDesktopPreferenceActive(pref: PwaDesktopPreference | null): boolean {
  if (!pref) return false
  return new Date(pref.expiresAt).getTime() > Date.now()
}

export function writePwaDesktopPreference(userId: string): void {
  const pref: PwaDesktopPreference = {
    mode: 'desktop',
    expiresAt: new Date(Date.now() + PWA_DESKTOP_TTL_MS).toISOString(),
  }
  localStorage.setItem(pwaDesktopLsKey(userId), JSON.stringify(pref))
}

export function clearPwaDesktopPreference(userId: string): void {
  localStorage.removeItem(pwaDesktopLsKey(userId))
}
