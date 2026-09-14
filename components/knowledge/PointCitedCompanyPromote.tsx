'use client'

// Lot Entreprise citée → Affecter (mandat Vincent 2026-09-14, suite du lot Entreprise
// citée → Responsable, cas Clim Exp'Air) — geste humain explicite qui transforme une
// entreprise simplement citée (détection textuelle, jamais une promotion automatique)
// soit en responsable structuré du Point, soit en responsable d'une Action ouverte
// précise. Jamais de Réserve/Échéance dans ce choix : ni l'une ni l'autre n'a de champ
// structurel humain-éditable pour une affectation aujourd'hui. Même squelette
// d'interaction que PointActionMenu (useTransition, popover inline, confirmation,
// Loader2, annulation).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { designateResponsibleCompanyAction } from '@/app/(dashboard)/sites/[id]/tracked-point-responsible-company-actions'
import { updateActionAssignmentAction } from '@/app/(dashboard)/actions/actions'

type Mode = null | 'choose' | 'confirmResponsible' | 'pickAction'

export function PointCitedCompanyPromote({
  siteId,
  pointId,
  companyId,
  companyName,
  openActions,
}: {
  siteId: string
  pointId: string
  companyId: string
  companyName: string
  openActions: Array<{ id: string; title: string; dueDate: string | null }>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>(null)
  const [actionId, setActionId] = useState('')
  const [error, setError] = useState<string | null>(null)

  function close() {
    setMode(null); setActionId(''); setError(null)
  }

  function submitResponsible() {
    setError(null)
    startTransition(async () => {
      const r = await designateResponsibleCompanyAction({ siteId, pointId, companyId })
      if (!r.ok) { setError(r.error); return }
      close(); router.refresh()
    })
  }

  function submitAction() {
    if (!actionId) return
    setError(null)
    const target = openActions.find((a) => a.id === actionId)
    const fd = new FormData()
    fd.set('id', actionId)
    fd.set('assigned_company_id', companyId)
    // updateActionAssignmentAction écrase due_date par ce qui est soumis : on repasse
    // toujours la date déjà connue de cette Action pour ne jamais l'effacer par effet
    // de bord d'une affectation qui ne parle que de l'entreprise.
    if (target?.dueDate) fd.set('due_date', target.dueDate)
    startTransition(async () => {
      const r = await updateActionAssignmentAction(fd)
      if (!r.ok) { setError(r.error); return }
      close(); router.refresh()
    })
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setMode(mode === null ? 'choose' : null)}
        className="rounded-md border border-dashed px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/60"
      >
        Affecter…
      </button>

      {mode === 'choose' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 max-w-[85vw] space-y-1 rounded-lg border bg-card p-1.5 shadow-md">
          <button type="button" onClick={() => setMode('confirmResponsible')}
            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium hover:bg-sky-50 dark:hover:bg-sky-950/40">
            Comme responsable du Point
          </button>
          <button
            type="button"
            onClick={() => { if (openActions.length > 0) setMode('pickAction') }}
            disabled={openActions.length === 0}
            className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-sky-950/40"
          >
            <span className="text-[12.5px] font-medium">À une Action…</span>
            {openActions.length === 0 && (
              <span className="text-[10.5px] text-muted-foreground">Aucune Action ouverte sur ce Point</span>
            )}
          </button>
        </div>
      )}

      {mode === 'confirmResponsible' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-72 max-w-[85vw] space-y-1.5 rounded-lg border bg-card p-2.5 shadow-md">
          <p className="text-[11px] font-medium text-foreground">
            Définir {companyName} comme responsable de ce Point ?
          </p>
          <p className="text-[11px] text-muted-foreground">
            Cette action transformera une entreprise simplement citée dans les preuves en responsabilité structurée.
          </p>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitResponsible} disabled={pending}
              className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer
            </button>
            <button type="button" onClick={close} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}

      {mode === 'pickAction' && (
        <div className="absolute right-0 top-full z-10 mt-1 w-80 max-w-[85vw] space-y-1.5 rounded-lg border bg-card p-2.5 shadow-md">
          <p className="text-[11px] font-medium text-foreground">Affecter {companyName} à quelle Action ?</p>
          <select value={actionId} onChange={(e) => setActionId(e.target.value)} disabled={pending}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring">
            <option value="">—</option>
            {openActions.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={submitAction} disabled={pending || !actionId}
              className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {pending && <Loader2 className="h-3 w-3 animate-spin" />} Confirmer
            </button>
            <button type="button" onClick={close} disabled={pending}
              className="rounded-md border px-2.5 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50">Annuler</button>
          </div>
        </div>
      )}
    </div>
  )
}
