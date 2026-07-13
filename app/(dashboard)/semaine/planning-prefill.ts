// PR 1 (continuité chantier → planification) — helper PUR, client-safe.
//
// Quand on arrive sur /semaine?site=<id> depuis une fiche chantier, le
// planificateur s'ouvre prérempli sur la première mission de CE chantier
// (dans l'ordre d'affichage du picker : nom puis contrat, tri français).
// Pas de mission sur ce chantier → '' (le dialogue reste vierge, l'utilisateur
// voit le picker groupé par site).

export interface PrefillMission {
  id: string
  name: string
  siteId: string
  contractName: string
}

const fr = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' })

export function pickInitialMissionId(
  missions: PrefillMission[],
  initialSiteId: string | undefined,
): string {
  if (!initialSiteId) return ''
  const ofSite = missions
    .filter((m) => m.siteId === initialSiteId)
    .sort((a, b) => fr(a.name, b.name) || fr(a.contractName, b.contractName))
  return ofSite[0]?.id ?? ''
}
