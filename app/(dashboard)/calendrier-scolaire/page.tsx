// Cette page a REJOINT le domaine Planning : /calendrier regroupe désormais les
// calendriers communs (vacances scolaires, jours fériés), l'adhésion par
// chantier et les fermetures à venir. La route reste : les liens existants ne
// cassent pas — ils arrivent au bon endroit.

import { redirect } from 'next/navigation'

export default function CalendrierScolaireRedirect() {
  redirect('/calendrier')
}
