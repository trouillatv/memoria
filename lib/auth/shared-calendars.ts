// Qui écrit les CALENDRIERS COMMUNS (jours fériés, vacances scolaires) ?
//
// Décision Vincent (2026-07-21) : ces calendriers sont GLOBAUX (mig 226) — les
// mêmes dates pour tous les tenants. Une saisie fausse fermerait des chantiers
// chez tout le monde : l'écriture est donc réservée à la plateforme.
//
//   • rôle `admin` ;
//   • ou le compte plateforme vincent.trouillat@memoria.nc (rôle manager dans
//     le tenant AGP — l'allowlist existe parce que le rôle ne suffit pas).
//
// Tout le monde continue de LIRE ces calendriers, et chaque organisation garde
// la main sur l'EFFET par chantier (fermé / travail prévu / non concerné).
// Les jours fermés supplémentaires restent des fermetures de chantier, saisies
// depuis la fiche du site.

const SHARED_CALENDAR_MANAGER_EMAILS = ['vincent.trouillat@memoria.nc']

export function canManageSharedCalendars(
  role: string | null | undefined,
  email: string | null | undefined,
): boolean {
  if (role === 'admin') return true
  if (!email) return false
  return SHARED_CALENDAR_MANAGER_EMAILS.includes(email.trim().toLowerCase())
}
