'use client'

// /EQUIPES V2 (Batch D) — la coquille persistante du drawer /equipes.
// Modélisé sur PersistentFicheSheet.tsx (app/(dashboard)/sites/[id]/views) :
// c'est l'ADRESSE qui dit ce qui est ouvert (`?team=`, plus tard `?person=`),
// jamais un état serveur — fermer ne redemande rien au serveur.
//
// Si `?team=<id>` pointe vers une équipe introuvable ou hors organisation,
// `team` arrive à `null` : le drawer ne s'ouvre simplement pas (fail-closed,
// jamais de page qui plante pour un id invalide tapé à la main).

import { usePathname, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { TeamDrawerBody, type TeamDrawerData } from './TeamDrawerBody'
import { PersonDrawerBody } from './PersonDrawerBody'
import type { PersonDrawerData } from './loadPersonDrawerData'

export function EquipesDetailSheet({
  team,
  person,
}: {
  team: TeamDrawerData | null
  person: PersonDrawerData | null
}) {
  const pathname = usePathname()
  const params = useSearchParams()

  const active: 'team' | 'person' | null = params.get('team') && team
    ? 'team'
    : params.get('person') && person
      ? 'person'
      : null

  function close() {
    const next = new URLSearchParams(params.toString())
    next.delete('team')
    next.delete('person')
    next.delete('personKind')
    next.delete('personPeriod')
    const qs = next.toString()
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }

  if (!active) return null

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[420px]">
        {active === 'team' && team && <TeamDrawerBody data={team} />}
        {active === 'person' && person && <PersonDrawerBody data={person} pathname={pathname} />}
      </SheetContent>
    </Sheet>
  )
}
