'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createProspectSite } from '@/lib/db/sites'

// Crée un dossier d'opportunité (prévisite AO) et envoie vers sa lecture AO, d'où
// l'on peut lancer la collecte terrain. Le site naît en phase 'prospect' :
// le MÊME dossier deviendra chantier si l'affaire est gagnée. Cf. mig 171.
export async function createProspectAction(formData: FormData): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Non autorisé')

  const name = String(formData.get('name') ?? '').trim()
  const clientName = String(formData.get('clientName') ?? '').trim()
  if (!name || !clientName) throw new Error('Nom du dossier et donneur d’ordre requis')

  const id = await createProspectSite({ name, clientName })
  revalidatePath('/opportunites')
  redirect(`/sites/${id}/ao`)
}
