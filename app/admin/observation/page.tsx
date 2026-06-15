// Fusionné dans /admin/activite (refonte admin 2026-06-15). Le tableau
// d'observation doublait largement le monitoring d'adoption ; ses graphes de
// doctrine (centrage, signaux, thèmes) ont été retirés ou repliés.
import { redirect } from 'next/navigation'
export default function AdminObservationRedirect() { redirect('/admin/activite') }
