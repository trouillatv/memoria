'use client'

// /EQUIPES V2 (Batch A) — retirer une personne TERRAIN de l'équipe (left_at,
// jamais une suppression du contact ni de son historique).

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { removeFieldPersonFromTeamAction } from './actions'

export function RemoveFieldMemberButton({
  teamId,
  membershipId,
  name,
}: {
  teamId: string
  membershipId: string
  name: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleRemove() {
    if (!confirm(`Retirer ${name} de l’équipe ?`)) return
    startTransition(async () => {
      const r = await removeFieldPersonFromTeamAction({ teamId, membershipId })
      if (!r.ok) { toast.error(r.error ?? 'Retrait impossible'); return }
      toast.success(`${name} retiré·e de l’équipe`)
      router.refresh()
    })
  }

  return (
    <Button
      size="icon-xs"
      variant="ghost"
      onClick={handleRemove}
      disabled={pending}
      aria-label={`Retirer ${name}`}
      data-testid={`remove-field-member-${membershipId}`}
    >
      <X />
    </Button>
  )
}
