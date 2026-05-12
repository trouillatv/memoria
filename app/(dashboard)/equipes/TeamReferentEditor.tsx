'use client'

// Phase 10 — Référent d'équipe (Slice : couleurs + référent)
//
// Doctrine V3 :
//   - Référent d'équipe = point de contact stable, pas une hiérarchie.
//   - Toujours désignable / retirable. Pas de blocage si non-membre.
//   - Wording : « Référent », jamais « Chef », « Lead », « Responsable ».

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserCircle2, Edit3, X } from 'lucide-react'
import { toast } from 'sonner'
import { setTeamReferentAction } from './actions'
import type { MemberLite } from './EditTeamMembersDialog'

interface Props {
  teamId: string
  teamName: string
  /** Référent actuel — null si aucun. */
  current: { id: string; name: string } | null
  /** Membres actifs de l'équipe (suggestions prioritaires). */
  members: MemberLite[]
  /** Tous les chefs d'équipe disponibles (fallback hors membres). */
  availableUsers: MemberLite[]
}

export function TeamReferentEditor({
  teamId,
  teamName,
  current,
  members,
  availableUsers,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  // Suggestions : membres en premier, puis autres chefs d'équipe disponibles
  // non déjà membres (pour cas Pierre Grand-Nouméa devient référent ailleurs).
  const memberIds = new Set(members.map((m) => m.id))
  const extras = availableUsers.filter((u) => !memberIds.has(u.id))

  function submit(userId: string | null) {
    startTransition(async () => {
      const r = await setTeamReferentAction({ teamId, userId })
      if (!r.ok) {
        toast.error(r.error ?? 'Erreur')
        return
      }
      toast.success(userId ? 'Référent désigné' : 'Référent retiré')
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md px-2 py-1 -mx-2 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={`Désigner le référent de l'équipe ${teamName}`}
      >
        <UserCircle2 className="h-3.5 w-3.5" />
        {current ? (
          <span>
            Référent&nbsp;:&nbsp;<span className="text-foreground font-medium">{current.name}</span>
          </span>
        ) : (
          <span className="italic">Aucun référent désigné</span>
        )}
        <Edit3 className="h-3 w-3 opacity-60" aria-hidden />
      </button>
    )
  }

  return (
    <div className="rounded-md border bg-card p-3 space-y-2 max-w-md">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
          <UserCircle2 className="h-3.5 w-3.5" />
          Référent de {teamName}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="p-0.5 rounded hover:bg-muted/50"
          aria-label="Fermer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1">
        {current && (
          <button
            type="button"
            onClick={() => submit(null)}
            disabled={pending}
            className="w-full text-left text-xs italic text-amber-700 hover:bg-amber-50 rounded px-2 py-1.5 disabled:opacity-50"
          >
            Retirer le référent (sans remplaçant)
          </button>
        )}

        {members.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-1">
              Membres de l&apos;équipe
            </div>
            {members.map((m) => (
              <ReferentChoice
                key={m.id}
                name={m.name}
                isCurrent={current?.id === m.id}
                onPick={() => submit(m.id)}
                disabled={pending}
              />
            ))}
          </>
        )}

        {extras.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-2">
              Autres chefs d&apos;équipe
            </div>
            {extras.map((m) => (
              <ReferentChoice
                key={m.id}
                name={m.name}
                isCurrent={current?.id === m.id}
                onPick={() => submit(m.id)}
                disabled={pending}
                hint="hors équipe"
              />
            ))}
          </>
        )}

        {members.length === 0 && extras.length === 0 && (
          <p className="text-xs italic text-muted-foreground px-2 py-1">
            Aucun utilisateur disponible.
          </p>
        )}
      </div>
    </div>
  )
}

function ReferentChoice({
  name,
  isCurrent,
  onPick,
  disabled,
  hint,
}: {
  name: string
  isCurrent: boolean
  onPick: () => void
  disabled: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled || isCurrent}
      className={
        'w-full text-left text-sm rounded px-2 py-1.5 transition-colors disabled:opacity-60 ' +
        (isCurrent
          ? 'bg-brand-50 text-brand-700 font-medium cursor-default dark:bg-brand-600/10'
          : 'hover:bg-muted')
      }
    >
      {name}
      {hint && <span className="ml-2 text-[10px] italic text-muted-foreground">({hint})</span>}
      {isCurrent && <span className="ml-2 text-[10px] uppercase tracking-wider">actuel</span>}
    </button>
  )
}
