'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createProspectDossier } from '@/lib/db/dossiers'

// Crée une opportunité = un LIEU + un DOSSIER (opération) en phase 'prospect', et
// envoie vers sa lecture AO, d'où l'on lance la collecte terrain. L'identité est le
// dossier : le MÊME dossier deviendra chantier si l'affaire est gagnée. Cf. mig 172.
export async function createProspectAction(formData: FormData): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Non autorisé')

  const name = String(formData.get('name') ?? '').trim()
  const clientName = String(formData.get('clientName') ?? '').trim()
  if (!name || !clientName) throw new Error('Nom du dossier et donneur d’ordre requis')

  const { dossierId } = await createProspectDossier({ name, clientName })
  revalidatePath('/opportunites')
  redirect(`/dossiers/${dossierId}`)
}
