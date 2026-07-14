'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.2)
//
// Dialog d'édition de la composition d'une équipe.
//   - Liste des membres actuels avec bouton "Retirer"
//   - Selecteur pour ajouter un chef_equipe non encore membre
//
// Doctrine V2 : on touche à la composition, pas à des stats individuelles.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, UserMinus, Users, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { addMemberToTeamAction, removeMemberFromTeamAction } from './actions'

export interface MemberLite {
  id: string
  name: string
  email: string
  /** Rôle applicatif (manager | chef_equipe) — affiché comme indice dans le
   *  sélecteur pour distinguer un manager d'un chef d'équipe. Optionnel. */
  role?: string
  /** Noms des autres équipes actives auxquelles cet utilisateur appartient
   *  déjà — utile dans le sélecteur d'ajout pour éviter d'ajouter quelqu'un
   *  qui est déjà dans une autre équipe sans le savoir. Optionnel. */
  currentTeamNames?: string[]
}

/** Libellé FR court du rôle, pour l'indice du sélecteur. */
function roleHint(role: string | undefined): string | null {
  switch (role) {
    case 'manager': return 'Manager'
    case 'chef_equipe': return "Chef d'équipe"
    default: return null
  }
}

interface Props {
  teamId: string
  teamName: string
  members: MemberLite[]
  /** Tous les chef_equipe actifs (membres ou orphelins) — on filtre côté client. */
  availableUsers: MemberLite[]
}

export function EditTeamMembersDialog({ teamId, teamName, members, availableUsers }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [pending, startTransition] = useTransition()

  const memberIds = new Set(members.map((m) => m.id))
  const candidates = availableUsers.filter((u) => !memberIds.has(u.id))

  function handleAdd() {
    if (!selectedUserId) return
    startTransition(async () => {
      const result = await addMemberToTeamAction({ teamId, userId: selectedUserId })
      if (result.ok) {
        toast.success('Membre ajouté')
        setSelectedUserId('')
        router.refresh()
      } else {
        toast.error(result.error ?? "Erreur ajout du membre")
      }
    })
  }

  function handleRemove(userId: string, name: string) {
    if (!confirm(`Retirer ${name} de l’équipe ${teamName} ?`)) return
    startTransition(async () => {
      const result = await removeMemberFromTeamAction({ teamId, userId })
      if (result.ok) {
        toast.success('Membre retiré')
        router.refresh()
      } else {
        toast.error(result.error ?? 'Erreur retrait du membre')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            data-testid={`edit-members-trigger-${teamId}`}
          >
            <Users />
            Éditer
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Composition — {teamName}</DialogTitle>
          <DialogDescription>
            Ajouter ou retirer des personnes de l’équipe. L’appartenance à une
            équipe est indépendante du rôle. Les missions planifiées associées
            resteront affectées tant que l’équipe existe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">
              Membres actuels ({members.length})
            </Label>
            {members.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground italic">
                Aucun membre pour l’instant.
              </p>
            ) : (
              <ul
                className="mt-2 divide-y rounded-lg border"
                data-testid="team-members-list"
              >
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemove(m.id, m.name)}
                      disabled={pending}
                      aria-label={`Retirer ${m.name}`}
                      data-testid={`remove-member-${m.id}`}
                    >
                      <UserMinus />
                      Retirer
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t pt-4">
            <Label htmlFor="add-member-select" className="text-xs text-muted-foreground">
              Ajouter un membre
            </Label>
            {candidates.length === 0 ? (
              // Nommer un manque sans offrir le geste, c'est une impasse : ce
              // message n'avait même pas de lien. On ouvre la porte.
              <div className="mt-2 space-y-1.5 rounded-lg border border-dashed p-3">
                <p className="text-sm text-muted-foreground">
                  Personne à ajouter pour l&apos;instant.
                </p>
                <Link
                  href="/intervenants"
                  className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-4 hover:no-underline"
                >
                  Créer une personne
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <Select
                  value={selectedUserId}
                  onValueChange={(v) => setSelectedUserId(v ?? '')}
                >
                  <SelectTrigger
                    id="add-member-select"
                    className="flex-1"
                    data-testid="add-member-select"
                  >
                    <SelectValue placeholder="Choisir une personne…" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((u) => {
                      // Exclut l'équipe courante (qu'on est en train d'éditer)
                      // des "autres équipes" affichées dans le badge.
                      const otherTeams = (u.currentTeamNames ?? []).filter(
                        (n) => n !== teamName,
                      )
                      const hint = roleHint(u.role)
                      return (
                        <SelectItem key={u.id} value={u.id}>
                          <span className="inline-flex items-center gap-2 flex-wrap">
                            <span>
                              {u.name} — {u.email}
                            </span>
                            {hint && (
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5">
                                {hint}
                              </span>
                            )}
                            {otherTeams.length > 0 && (
                              <span className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                déjà dans {otherTeams.join(', ')}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleAdd}
                  disabled={!selectedUserId || pending}
                  data-testid="add-member-submit"
                >
                  <UserPlus />
                  Ajouter
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
