'use client'

// Sélecteur de personne pour amorcer une passation directement depuis
// /handovers (Vincent 2026-05-27). Avant : le bouton renvoyait vers la liste
// /intervenants sans rien expliquer (fausse impasse). Maintenant : on choisit
// la personne ici et le brief est généré + ouvert. Sujet = la mémoire/les
// sites, jamais la personne.

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Search, Loader2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { createMemberChangeBriefAction } from './actions'

export function PreparePassationButton({
  people,
}: {
  people: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [pending, start] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? people.filter((p) => p.label.toLowerCase().includes(s)) : people
  }, [q, people])

  function pick(id: string) {
    setBusyId(id)
    start(async () => {
      const r = await createMemberChangeBriefAction({ subjectUserId: id, effectiveDate: effectiveDate || null })
      if (r.ok && r.briefId) {
        setOpen(false)
        router.push(`/handovers/${r.briefId}`)
      } else {
        toast.error(r.error ?? 'Erreur')
        setBusyId(null)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs text-brand-800 transition-colors hover:bg-brand-100 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-200"
          />
        }
      >
        <Users className="h-3.5 w-3.5" />
        Préparer une passation (une personne change d&apos;équipe)
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pour qui préparer le passage de témoin ?</DialogTitle>
          <DialogDescription>
            Choisis la personne qui change d&apos;équipe ou s&apos;en va. Le brief
            compile les sites connus et la mémoire utile — jamais la personne.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="passation-date" className="text-xs font-medium text-foreground">
              Effectif à partir du <span className="text-destructive">*</span>
            </label>
            <input
              id="passation-date"
              type="date"
              required
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {effectiveDate
                ? 'Choisis ensuite la personne ci-dessous.'
                : 'Date à laquelle la personne est remplacée — obligatoire pour continuer.'}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher une personne…"
              className="flex-1 bg-transparent text-sm focus:outline-none"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto divide-y rounded-md border">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground italic">
                {people.length === 0 ? 'Aucun intervenant disponible.' : 'Aucune personne ne correspond.'}
              </li>
            ) : (
              filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={pending || !effectiveDate}
                    title={!effectiveDate ? "Renseigne d'abord la date d'effet" : undefined}
                    onClick={() => pick(p.id)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="truncate">{p.label}</span>
                    {busyId === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    ) : (
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
