'use client'

// /EQUIPES V2 (Batch A) — rattachement groupé des « personnes sans équipe ».
//
// Réutilise le geste unitaire déjà audité (addMemberToTeamAction) plutôt que
// d'écrire une mutation bulk parallèle : la garde d'accès, l'audit log et les
// messages d'erreur restent identiques, qu'on rattache une personne ou dix.
// Le nombre d'orphelins est petit par construction (bandeau d'alerte), donc
// la boucle séquentielle n'est pas un problème de performance ici.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { addMemberToTeamAction } from './actions'

interface OrphanLite {
  id: string
  name: string
}

interface TeamLite {
  id: string
  name: string
}

export function OrphansBulkAssign({ orphans, teams }: { orphans: OrphanLite[]; teams: TeamLite[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [teamId, setTeamId] = useState<string>('')
  const [pending, startTransition] = useTransition()

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function assign() {
    if (!teamId || selected.size === 0) return
    const ids = [...selected]
    startTransition(async () => {
      let okCount = 0
      const errors: string[] = []
      for (const userId of ids) {
        const r = await addMemberToTeamAction({ teamId, userId })
        if (r.ok) okCount += 1
        else errors.push(r.error ?? 'Erreur inconnue')
      }
      if (okCount > 0) toast.success(`${okCount} personne${okCount > 1 ? 's' : ''} rattachée${okCount > 1 ? 's' : ''}`)
      if (errors.length > 0) toast.error(errors[0])
      setSelected(new Set())
      setTeamId('')
      router.refresh()
    })
  }

  if (teams.length === 0) return null

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-3">
      <p className="text-xs font-medium text-amber-900">Rattacher en une fois</p>
      <ul className="space-y-1.5">
        {orphans.map((o) => (
          <li key={o.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              id={`orphan-${o.id}`}
              checked={selected.has(o.id)}
              onChange={() => toggle(o.id)}
              disabled={pending}
              className="h-4 w-4 rounded border-amber-400"
            />
            <label htmlFor={`orphan-${o.id}`} className="text-sm text-amber-900">
              {o.name}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Select value={teamId} onValueChange={(v) => setTeamId(v ?? '')}>
          <SelectTrigger className="h-8 w-[220px] bg-white text-sm">
            <SelectValue placeholder="Choisir une équipe…" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={assign}
          disabled={!teamId || selected.size === 0 || pending}
          data-testid="orphans-bulk-assign-submit"
        >
          <UsersRound />
          Rattacher {selected.size > 0 ? `(${selected.size})` : ''}
        </Button>
      </div>
    </div>
  )
}
