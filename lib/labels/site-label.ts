// PR 4 — l'étiquette NON AMBIGUË d'un chantier, partagée par TOUS les
// sélecteurs (planificateur, nouvelle mission, création inline).
//
// Constat Guillaume : « Pointière » ne veut rien dire tout seul — il y a le
// magasin Discount de Pointière et la mairie de Pointière. Le nom du chantier
// n'identifie pas un chantier ; c'est le couple client + lieu qui l'identifie.
//
// Client-safe (aucun import serveur) : utilisable dans un Client Component.

export function siteLabel(siteName: string, clientName?: string | null): string {
  const client = clientName?.trim()
  return client ? `${client} — ${siteName}` : siteName
}
