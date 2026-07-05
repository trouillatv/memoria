'use client'

// « Pourquoi êtes-vous ici ? » — au DÉMARRAGE de la visite. MemorIA doit connaître
// l'objet dès le début : ça donne le contexte au résumé IA et au compte-rendu.
// Non bloquant (« Plus tard ») pour ne pas casser la friction zéro, mais mis en
// avant. Presets 1-tap + saisie libre.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Target, Check } from 'lucide-react'
import { toast } from 'sonner'
import { setVisitObjectiveAction } from './visit-actions'

const PRESETS = ['Visite de suivi', 'Contrôle', 'Pré-réception', 'Réception', 'SAV', 'Levée de réserves']

export function VisitObjectivePrompt({ reportId, siteId }: { reportId: string; siteId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [custom, setCustom] = useState('')
  const [hidden, setHidden] = useState(false)
  if (hidden) return null

  function save(objective: string) {
    const v = objective.trim()
    if (!v) return
    start(async () => {
      const r = await setVisitObjectiveAction({ report_id: reportId, site_id: siteId, objective: v })
      if (r.ok) {
        setHidden(true)
        toast.success('Objet enregistré', { duration: 1200 })
        router.refresh()
      } else {
        toast.error(r.error)
      }
    })
  }

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          <Target className="h-4 w-4" /> Pourquoi êtes-vous ici ?
        </h2>
        <button type="button" onClick={() => setHidden(true)} className="text-xs text-muted-foreground">Plus tard</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => save(p)}
            disabled={pending}
            className="rounded-full border border-emerald-300 bg-background px-3 py-1.5 text-[13px] font-medium text-emerald-800 active:scale-[0.97] disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-200"
          >
            {p}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Autre — ex. vérifier les infiltrations toiture"
          maxLength={300}
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          onClick={() => save(custom)}
          disabled={pending || custom.trim().length === 0}
          aria-label="Enregistrer l'objet"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[11px] text-emerald-800/70 dark:text-emerald-200/60">
        Ça donne le contexte au résumé et au compte-rendu.
      </p>
    </section>
  )
}
