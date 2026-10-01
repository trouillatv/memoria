// /EQUIPES V2 — CORRECTIF UX FINAL (2026-10-01) — vue détail équipe/personne
// pleine largeur, même route `/equipes` (`?team=`/`?person=`). Remplace
// l'ancien drawer latéral (EquipesDetailSheet, Sheet 420px) devenu trop
// étroit pour le contenu réel. C'est toujours l'ADRESSE qui dit ce qui est
// ouvert — fermer/revenir est une navigation normale (<Link>), plus de
// window.history.replaceState() ad hoc.
//
// Priorité d'activation : une personne active prime sur une équipe active
// (cliquer une personne depuis l'onglet Membres d'une équipe doit bien
// afficher la personne). Le `backHref`/`backLabel` reconstruisent alors le
// contexte équipe d'origine si `?team=` est encore présent dans l'URL.
//
// Si `?team=<id>`/`?person=<id>` pointe vers une entité introuvable ou hors
// organisation, la donnée correspondante arrive à `null` — page.tsx ne doit
// alors simplement pas activer cette vue (fail-closed, jamais de page qui
// plante pour un id invalide tapé à la main).

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { TeamDetailBody, type TeamDrawerData } from './TeamDetailBody'
import { PersonDetailBody } from './PersonDetailBody'
import type { PersonDrawerData } from './loadPersonDrawerData'
import type { MemberLite } from './EditTeamMembersDialog'

export function EquipesDetailView({
  active,
  team,
  person,
  availableUsers,
  backHref,
  backLabel,
  personTeamId,
}: {
  active: 'team' | 'person'
  team: TeamDrawerData | null
  person: PersonDrawerData | null
  availableUsers: MemberLite[]
  backHref: string
  backLabel: string
  personTeamId?: string
}) {
  return (
    <div className="space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {backLabel}
      </Link>
      {active === 'team' && team && <TeamDetailBody data={team} availableUsers={availableUsers} />}
      {active === 'person' && person && (
        <PersonDetailBody data={person} pathname="/equipes" teamId={personTeamId} />
      )}
    </div>
  )
}
