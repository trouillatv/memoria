// Fusionné dans /admin/personnes (refonte admin 2026-06-15) : le suivi des
// téléphones des chefs d'équipe (prérequis WhatsApp) est désormais une colonne
// de la page Personnes. La préparation du soir elle-même se consulte sur
// /preparation (page non-admin, inchangée).
import { redirect } from 'next/navigation'
export default function AdminPreparationRedirect() { redirect('/admin/personnes') }
