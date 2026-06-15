// Fusionné dans /admin/personnes (refonte admin 2026-06-15).
// Les composants de ce dossier (CreateUserForm, UserRoleSelect…) restent
// utilisés par la nouvelle page Personnes.
import { redirect } from 'next/navigation'
export default function AdminUsersRedirect() { redirect('/admin/personnes') }
