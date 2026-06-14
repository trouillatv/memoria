'use client'

// Sprint Équipes B (Vincent 2026-05-21) — Édition inline des spécialités
// déclarées d'une équipe, depuis la fiche /equipes/[id].
//
// Doctrine V2 : tags DÉCLARÉS par le manager. Jamais inférés, jamais
// comparatifs. L'UI elle-même n'affiche aucun calcul ("équipe la plus
// spécialisée en X" interdit).
//
// Mode d'usage : par défaut READ-ONLY, on clique « Modifier » pour entrer
// en mode édition. Anti-clics intempestifs (les spécialités sont du contenu
// stable, pas un état runtime).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Sparkles, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import {
  TeamSpecialtiesEditor,
  SpecialtyBadge,
} from '@/components/ui/team-specialties'
import { Button } from '@/components/ui/button'
import { setTeamSpecialtiesAction } from '../actions'

interface Props {
  teamId: string
  initial: string[]
}

export function TeamSpecialtiesSection({ teamId, initial }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>(initial)
  const [pending, startTransition] = useTransition()

  function cancel() {
    setDraft(initial)
    setEditing(false)
  }

  function save() {
    startTransition(async () => {
      const result = await setTeamSpecialtiesAction({
        teamId,
        specialties: draft,
      })
      if (result.ok) {
        toast.success('Spécialités mises à jour')
        setEditing(false)
        router.refresh()
      } else {
        toast.error(result.error ?? 'Erreur')
      }
    })
  }

  // ── Lecture seule ────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-600" />
            Spécialités déclarées
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            data-testid="team-specialties-edit"
          >
            <Pencil className="h-3.5 w-3.5" />
            Modifier
          </Button>
        </div>
        {initial.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Aucune spécialité déclarée. L&apos;équipe peut tout faire.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {initial.map((s) => (
              <SpecialtyBadge key={s} k={s} size="md" />
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Servent au matcher de dossiers. Déclaratif uniquement — jamais inféré, jamais comparatif.
        </p>
      </section>
    )
  }

  // ── Édition ──────────────────────────────────────────────────────────────
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" />
          Spécialités déclarées
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={cancel}
            disabled={pending}
          >
            <X className="h-3.5 w-3.5" />
            Annuler
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={pending}
            data-testid="team-specialties-save"
          >
            <Check className="h-3.5 w-3.5" />
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>

      <TeamSpecialtiesEditor value={draft} onChange={setDraft} />
    </section>
  )
}
