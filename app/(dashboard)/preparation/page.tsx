import { redirect } from 'next/navigation'

// « Préparation », pour un conducteur, veut dire PRÉPARER SA VISITE — pas les
// envois WhatsApp du briefing du soir (l'ancienne cible de cette route, fusion
// UX 2026-05-14, qui désorientait : F19 de l'audit terrain). On envoie vers les
// chantiers : chaque fiche porte « Préparer ma visite ». Les envois du soir
// vivent sur /briefing (lien direct pour les habitués : /briefing#envois).
export default function PreparationRedirectPage() {
  redirect('/sites')
}
