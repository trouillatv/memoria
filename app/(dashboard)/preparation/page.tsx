// Page Préparation fusionnée avec /briefing (cf. décision UX 2026-05-14).
// La section "Préparation des envois WhatsApp" est désormais une partie
// du briefing du soir avec un pivot par agent et un drawer latéral.
// On conserve la route /preparation pour ne pas casser les bookmarks.

import { redirect } from 'next/navigation'

export default function PreparationRedirectPage() {
  redirect('/briefing#envois')
}
