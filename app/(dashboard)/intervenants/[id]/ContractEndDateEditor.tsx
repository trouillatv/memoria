'use client'

// Sprint E — Éditeur de la date de fin de contrat sur la fiche intervenant.
// Vincent 2026-05-22.
//
// Manager + admin. Self-exclu (la personne ne voit pas son propre champ).
// Saisie d'un fait administratif — le sujet doctrinal reste la passation
// de mémoire opérationnelle, pas la valeur de la personne.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Save, X, Calendar, CalendarPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { updateContractEndDateAction } from '@/app/(dashboard)/continuite/actions'

interface Props {
  targetUserId: string
  initialDate: string | null
  employmentType: 'cdi' | 'cdd' | 'cdi_chantier' | null
  /** True si le visiteur consulte sa propre fiche — composant n'apparaît pas. */
  isSelf: boolean
}

export function ContractEndDateEditor({
  targetUserId,
  initialDate,
  employmentType,
  isSelf,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialDate ?? '')
  const [pending, startTransition] = useTransition()

  // Ouvre l'édition en partant de la date actuelle.
  function openEdit() {
    setDraft(initialDate ?? '')
    setEditing(true)
  }
  // Prolongation (renouvellement) : pré-remplit +6 mois après la fin actuelle,
  // éditable. Un CDD peut être renouvelé par le même agent — c'est juste une
  // nouvelle date de fin.
  function openProlong() {
    const base = initialDate ? new Date(initialDate + 'T00:00:00') : new Date()
    base.setMonth(base.getMonth() + 6)
    setDraft(base.toISOString().slice(0, 10))
    setEditing(true)
  }

  // Self-exclu — on n'affiche rien
  if (isSelf) return null

  // CDI sans date prévue : on n'affiche le champ que si on est manager qui veut
  // l'initialiser. CDD et CDI Chantier : on affiche toujours.
  const isLimitedContract = employmentType === 'cdd' || employmentType === 'cdi_chantier'

  function save() {
    startTransition(async () => {
      const r = await updateContractEndDateAction({
        targetUserId,
        date: draft.trim() || null,
      })
      if (r.ok) {
        toast.success('Date de fin de contrat enregistrée')
        setEditing(false)
        router.refresh()
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  function clear() {
    startTransition(async () => {
      const r = await updateContractEndDateAction({ targetUserId, date: null })
      if (r.ok) {
        toast.success('Date effacée')
        setEditing(false)
        router.refresh()
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  const fmtFr = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  // Mode lecture
  if (!editing) {
    if (!initialDate && !isLimitedContract) {
      // CDI sans date — bouton compact pour initialiser (rare)
      return (
        <div className="mt-1">
          <Button variant="ghost" size="sm" onClick={openEdit} className="text-xs h-7">
            <Calendar className="h-3 w-3" />
            Ajouter une date de fin (si CDD oublié)
          </Button>
        </div>
      )
    }

    return (
      <div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs">
            <span className="text-muted-foreground">Contrat se termine le </span>
            {initialDate ? (
              <span className="font-medium text-foreground">{fmtFr(initialDate)}</span>
            ) : (
              <span className="italic text-muted-foreground">non renseigné</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {initialDate && (
              <Button variant="ghost" size="sm" onClick={openProlong} className="h-7 text-xs text-emerald-700 dark:text-emerald-300">
                <CalendarPlus className="h-3 w-3" />
                Prolonger
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={openEdit} className="h-7 text-xs">
              <Pencil className="h-3 w-3" />
              {initialDate ? 'Modifier' : 'Renseigner'}
            </Button>
          </div>
        </div>
        {initialDate && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            Renouvelé (même agent ou autre) → <strong>Prolonger</strong> (nouvelle date de fin).
            Sinon, laisse la date : la passation sera à préparer dans <a href="/continuite" className="underline">Continuité</a>.
          </p>
        )}
      </div>
    )
  }

  // Mode édition
  return (
    <div className="mt-2 rounded-md border border-brand-300 bg-brand-50/30 dark:bg-brand-950/20 px-3 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <Calendar className="h-3.5 w-3.5 text-brand-600" />
        <label htmlFor={`contract-end-${targetUserId}`} className="text-xs font-medium">
          Date de fin de contrat
        </label>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          id={`contract-end-${targetUserId}`}
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          className="h-8 rounded border bg-background px-2 text-xs"
        />
        <Button size="sm" onClick={save} disabled={pending} className="h-8">
          <Save className="h-3 w-3" />
          Enregistrer
        </Button>
        {initialDate && (
          <Button variant="ghost" size="sm" onClick={clear} disabled={pending} className="h-8 text-xs">
            Effacer
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending} className="h-8">
          <X className="h-3 w-3" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground italic">
        Sert à anticiper la passation de la mémoire opérationnelle. Cf.{' '}
        <a href="/continuite" className="underline">/continuite</a>.
      </p>
    </div>
  )
}
