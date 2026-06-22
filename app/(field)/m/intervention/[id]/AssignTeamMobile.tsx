'use client'

// Affecter / Prendre en charge une intervention orpheline sur le terrain, pour
// pouvoir la démarrer. Gérant : choisit une équipe. Chef : prend pour son équipe.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { claimInterventionTeamAction } from './actions'

interface Team { id: string; name: string }

export function AssignTeamMobile({ interventionId, teams, canManage }: { interventionId: string; teams: Team[]; canManage: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function assign(teamId: string) {
    const fd = new FormData()
    fd.set('id', interventionId)
    fd.set('teamId', teamId)
    startTransition(async () => {
      const r = await claimInterventionTeamAction(fd)
      if (r && 'error' in r && r.error) { toast.error(r.error); return }
      toast.success('Intervention affectée — vous pouvez la démarrer.')
      setOpen(false)
      router.refresh()
    })
  }

  if (teams.length === 0) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Cette intervention n&apos;est affectée à personne. {canManage ? 'Aucune équipe active à proposer.' : "Demandez au gérant de vous l'affecter."}
      </p>
    )
  }

  // Chef avec une seule équipe : prise en charge directe (un tap).
  if (teams.length === 1 && !canManage) {
    return (
      <button type="button" onClick={() => assign(teams[0].id)} disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-foreground text-base font-medium px-4 py-4 active:scale-[0.99] disabled:opacity-50"
        style={{ minHeight: 64 }}>
        {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Users className="h-5 w-5" />}
        Prendre en charge
      </button>
    )
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-foreground text-base font-medium px-4 py-4 active:scale-[0.99]"
        style={{ minHeight: 64 }}>
        <Users className="h-5 w-5" /> {canManage ? 'Affecter une équipe' : 'Prendre en charge'}
      </button>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2">
      <p className="text-sm font-medium">{canManage ? 'Affecter à une équipe' : 'Prendre pour mon équipe'}</p>
      <div className="grid gap-1.5">
        {teams.map((t) => (
          <button key={t.id} type="button" onClick={() => assign(t.id)} disabled={pending}
            className="w-full text-left rounded-lg border px-3 py-3 text-sm font-medium hover:bg-muted/40 active:scale-[0.99] disabled:opacity-50">
            {t.name}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setOpen(false)} disabled={pending} className="text-xs text-muted-foreground">Annuler</button>
    </div>
  )
}
