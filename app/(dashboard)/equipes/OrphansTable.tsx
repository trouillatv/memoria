'use client'

// /EQUIPES V2 (Lot visuel 2026-10-01) — table dense des « personnes sans
// équipe », remplace OrphansBulkAssign.tsx.
//
// Les deux populations (comptes applicatifs listOrphanUsers() et contacts
// terrain listOrphanContacts()) restent deux identités disjointes — jamais
// fusionnées en base — mais sont désormais affichées côte à côte (colonne
// Type) pour permettre un rattachement groupé unique. Chaque ligne route
// vers le geste existant adapté à sa nature :
//   - compte applicatif → addMemberToTeamAction (team_members)
//   - contact terrain   → attachFieldPersonToTeamAction (team_field_members)
// Le nombre d'orphelins reste petit par construction (bandeau d'alerte),
// donc la boucle séquentielle n'est pas un problème de performance ici.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UsersRound, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { addMemberToTeamAction, attachFieldPersonToTeamAction } from './actions'

export interface OrphanRow {
  id: string
  kind: 'user' | 'contact'
  name: string
  job: string | null
  companyName: string | null
}

interface TeamLite {
  id: string
  name: string
}

const VISIBLE_ROWS = 5

export function OrphansTable({ orphans, teams }: { orphans: OrphanRow[]; teams: TeamLite[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [teamId, setTeamId] = useState<string>('')
  const [expanded, setExpanded] = useState(false)
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
    const rows = orphans.filter((o) => selected.has(o.id))
    startTransition(async () => {
      let okCount = 0
      const errors: string[] = []
      for (const row of rows) {
        const r =
          row.kind === 'user'
            ? await addMemberToTeamAction({ teamId, userId: row.id })
            : await attachFieldPersonToTeamAction({ teamId, contactId: row.id })
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

  if (teams.length === 0 || orphans.length === 0) return null

  const visible = expanded ? orphans : orphans.slice(0, VISIBLE_ROWS)
  const hasMore = orphans.length > VISIBLE_ROWS

  return (
    <div className="space-y-2">
      {/* Desktop/tablette — table dense */}
      <div className="hidden overflow-hidden rounded-lg border border-amber-200/80 bg-white/60 md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-px" />
              <TableHead>Nom</TableHead>
              <TableHead>Fonction</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Organisation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody data-testid="orphans-list">
            {visible.map((o) => (
              <TableRow key={o.id} data-slot="orphan-row" className="hover:bg-amber-50/60">
                <TableCell>
                  <input
                    type="checkbox"
                    id={`orphan-${o.id}`}
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    disabled={pending}
                    className="h-4 w-4 rounded border-amber-400"
                  />
                </TableCell>
                <TableCell>
                  <label htmlFor={`orphan-${o.id}`} className="text-sm text-amber-950">
                    {o.name}
                  </label>
                </TableCell>
                <TableCell className="text-sm text-amber-900/80">{o.job ?? '—'}</TableCell>
                <TableCell className="text-xs text-amber-800/80">
                  {o.kind === 'user' ? 'Accès' : 'Terrain'}
                </TableCell>
                <TableCell className="text-sm text-amber-900/80">{o.companyName ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile — liste compacte, même sélection que la table */}
      <div
        className="divide-y divide-amber-200/60 rounded-lg border border-amber-200/80 bg-white/60 md:hidden"
        data-testid="orphans-list-mobile"
      >
        {visible.map((o) => (
          <label
            key={o.id}
            htmlFor={`orphan-mobile-${o.id}`}
            data-slot="orphan-row-mobile"
            className="flex items-start gap-2.5 p-2.5"
          >
            <input
              type="checkbox"
              id={`orphan-mobile-${o.id}`}
              checked={selected.has(o.id)}
              onChange={() => toggle(o.id)}
              disabled={pending}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-amber-950">{o.name}</div>
              <div className="text-xs text-amber-900/70">
                {o.job ?? '—'} · {o.kind === 'user' ? 'Accès' : 'Terrain'}
                {o.companyName && ` · ${o.companyName}`}
              </div>
            </div>
          </label>
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-amber-900 hover:text-amber-950"
        >
          {expanded ? (
            <>
              Réduire <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Tout voir ({orphans.length}) <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      )}

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
          Affecter {selected.size > 0 ? `(${selected.size})` : ''}
        </Button>
      </div>
    </div>
  )
}
