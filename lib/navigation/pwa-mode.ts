// Gestion du mode bureau temporaire dans la PWA.
//
// La PWA est une interface terrain (destination par défaut : /m). L'utilisateur
// peut basculer sur le bureau pour une tâche ponctuelle — ce choix est valide
// 15 minutes et expire silencieusement. À chaque navigation dans le bureau,
// l'expiration est repoussée (fenêtre glissante). Quand la fenêtre se ferme ou
// que la session dépasse 15 min sans navigation, la prochaine ouverture de la
// PWA revient automatiquement sur /m.
//
// Deux cookies (lisibles côté JS pour SwitchToDesktopLink) :
//   pwa_standalone   = "1"                   (pose par PwaStandaloneDetector)
//   pwa_desktop_until = ISO string            (pose par SwitchToDesktopLink)

export const COOKIE_PWA_STANDALONE = 'pwa_standalone'
export const COOKIE_PWA_DESKTOP_UNTIL = 'pwa_desktop_until'

export const PWA_DESKTOP_TTL_MS = 15 * 60 * 1000 // 15 minutes

/** Retourne true si la fenêtre bureau est encore valide. */
export function isPwaDesktopActive(desktopUntilValue: string | undefined | null): boolean {
  if (!desktopUntilValue) return false
  return new Date(desktopUntilValue).getTime() > Date.now()
}

/** Valeur ISO à poser dans le cookie lors d'une bascule ou d'un renouvellement. */
export function makePwaDesktopUntilValue(): string {
  return new Date(Date.now() + PWA_DESKTOP_TTL_MS).toISOString()
}
