// Sprint 3 — UX-8 Mode litige express : wizard 30 secondes.
//
// Doctrine V5 — Pilier 1 + Verrou V1 + Verrou V4 :
//   - Mono-tâche : UNE seule action visible à la fois.
//   - 4 étapes : site → période → types → dossier prêt.
//   - Pas de menu, pas de sidebar (cf. layout immersif).
//   - Wording strictement passif descriptif.
//   - Pas de "ALERTE", pas de rouge, pas d'urgence visuelle agressive.
//
// La page est un Server Component qui charge la liste des sites, puis
// délègue le wizard à un Client Component (`LitigeWizard`).

import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { listSites } from '@/lib/db/sites'
import { listContracts } from '@/lib/db/contracts'
import { LitigeWizard } from './LitigeWizard'

export const dynamic = 'force-dynamic'

export default async function LitigePage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')
  if (user.role === 'chef_equipe') redirect('/m')
  if (user.role !== 'admin' && user.role !== 'manager') redirect('/dashboard')

  const [sites, contracts] = await Promise.all([listSites(), listContracts()])
  const siteOptions = sites.map((s) => ({ id: s.id, name: s.name }))
  const contractOptions = contracts
    .filter((c) => c.status === 'active' || c.status === 'paused')
    .map((c) => ({ id: c.id, name: c.name, client_name: c.client_name }))

  return <LitigeWizard contracts={contractOptions} sites={siteOptions} />
}
