'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { updateDossierPhase } from '@/lib/db/dossiers'
import type { DossierPhase } from '@/types/db'

const ALLOWED: DossierPhase[] = ['prospect', 'en_ao', 'actif', 'perdu', 'archive']

// Soudure arrière : avancer le dossier dans son cycle de vie. « Marché gagné »
// (actif) ne copie rien — le même dossier devient chantier. Cf. mig 172.
export async function setDossierPhaseAction(formData: FormData): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Non autorisé')

  const dossierId = String(formData.get('dossierId') ?? '')
  const phase = String(formData.get('phase') ?? '') as DossierPhase
  if (!dossierId || !ALLOWED.includes(phase)) throw new Error('Paramètres invalides')

  await updateDossierPhase(dossierId, phase)
  revalidatePath(`/dossiers/${dossierId}`)
}
