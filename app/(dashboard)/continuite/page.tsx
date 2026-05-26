import { redirect } from 'next/navigation'

// Fusionné dans /handovers (Vincent 2026-05-27) : « Continuité » et « Passages
// de témoin » étaient deux entrées redondantes (trop de confusion). Le radar
// d'anticipation (fins de contrat) vit désormais en tête de /handovers.
// On garde cette route en redirection pour ne casser aucun lien existant.
export default function ContinuiteRedirect() {
  redirect('/handovers')
}
