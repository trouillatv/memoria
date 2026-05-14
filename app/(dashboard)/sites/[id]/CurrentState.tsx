import type { SiteCurrentState } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Section État actuel : 4 stats compactes pattern shadcn.
 *
 * Doctrine produit (reste valide) :
 *   ❌ pas de delta de comparaison
 *   ❌ pas de couleur d'alerte sur "anomalies ouvertes"
 *   ✅ "0 anomalie ouverte" (statut technique, pas évaluation)
 */

const SLOT_LABELS: Record<string, string> = {
  morning: 'matin',
  afternoon: 'après-midi',
  evening: 'soir',
}

const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function formatLastPassage(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays < 1 && d.getDate() === now.getDate()) return "aujourd'hui"
  if (diffDays === 1 || (diffDays < 2 && d.getDate() !== now.getDate())) return 'hier'
  if (diffDays < 7) return FR_DAYS[d.getDay()]
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function formatNextPassage(iso: string | null, slot: string | null): { day: string; slot: string } {
  if (!iso) return { day: '—', slot: '' }
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86_400_000)
  let day = ''
  if (diffDays < 7) day = FR_DAYS[d.getDay()]
  else day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  return { day, slot: slot ? SLOT_LABELS[slot] ?? '' : '' }
}

export function CurrentState({ state }: { state: SiteCurrentState }) {
  const lastLabel = formatLastPassage(state.lastPassageAt)
  const next = formatNextPassage(state.nextScheduledAt, state.nextScheduledSlot)

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Stat
        value={state.passagesThisMonth}
        label="passages ce mois"
      />
      <Stat
        value={state.openAnomalies}
        label={state.openAnomalies === 1 ? 'anomalie ouverte' : 'anomalies ouvertes'}
      />
      <Stat
        value={lastLabel}
        label="dernier passage"
        detail={
          state.lastPassageActor
            ? state.lastPassagePhotoCount > 0
              ? `${state.lastPassageActor}, ${state.lastPassagePhotoCount} photo${state.lastPassagePhotoCount > 1 ? 's' : ''}`
              : state.lastPassageActor
            : null
        }
      />
      <Stat
        value={next.day}
        label="prochain passage"
        detail={next.slot || null}
      />
    </div>
  )
}

function Stat({
  value,
  label,
  detail,
}: {
  value: number | string
  label: string
  detail?: string | null
}) {
  return (
    <div className="space-y-1">
      <div className="text-2xl font-semibold tabular-nums leading-none">
        {value}
      </div>
      <div className="text-xs text-muted-foreground leading-snug">
        {label}
      </div>
      {detail && (
        <div className="text-xs text-muted-foreground italic">
          {detail}
        </div>
      )}
    </div>
  )
}
