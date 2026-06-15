// Fusionné dans /admin/personnes (refonte admin 2026-06-15).
// OrgForms.tsx (CreateOrgForm, MoveUserOrgForm…) reste utilisé par Personnes.
import { redirect } from 'next/navigation'
export default function AdminOrgsRedirect() { redirect('/admin/personnes') }
