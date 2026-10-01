'use client'

// /EQUIPES V2 — CORRECTIF UX FINAL (2026-10-01) — bouton header « + Ajouter
// une personne ». Réutilise AddIntervenantDialog (recherche anti-doublon +
// création + rattachement optionnel à une ou plusieurs équipes) sans
// dupliquer sa mécanique. Seul rôle de ce wrapper : fournir `onDone` (refresh
// en place, jamais de redirection vers /intervenants) — un Server Component
// ne peut pas passer directement une fonction cliente en prop.

import { useRouter } from 'next/navigation'
import { AddIntervenantDialog } from '@/app/(dashboard)/intervenants/AddIntervenantDialog'

export function AddPersonButton({ teams }: { teams: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  return (
    <AddIntervenantDialog
      teams={teams}
      triggerLabel="Ajouter une personne"
      entityNoun="personne"
      onDone={() => router.refresh()}
    />
  )
}
