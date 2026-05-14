import type { SiteCurrentState } from '@/lib/db/site-cockpit'
import { SectionTitle } from './SectionTitle'

/**
 * V5.1.3 — Section 2 : ÉTAT ACTUEL
 *
 * "Le glance 3 secondes." 4 chiffres typographiques, font-light, sur paper
 * crème. AUCUNE card colorée, AUCUN donut, AUCUNE comparaison delta.
 *
 * PIÈGES À ÉVITER (verrou doctrinal V5.1) :
 *   ❌ "Aucune anomalie active" en empty state → félicitation implicite
 *   ✅ "0 anomalie ouverte" (statut technique, pas évaluation)
 *   ❌ ajouter "+2 vs avril" / delta de comparaison
 *   ❌ couleur d'alerte sur "anomalies ouvertes" — la saillance vit en Section 4
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
    <section className="space-y-6">
      <SectionTitle>État actuel</SectionTitle>
      <div className="flex flex-wrap gap-x-12 gap-y-10 md:gap-x-16 pt-2">
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
    </section>
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
    <div className="min-w-0">
      <div
        className="text-5xl font-light tabular-nums leading-none tracking-tight"
        style={{ color: '#0a0a0a' }}
      >
        {value}
      </div>
      <div
        className="text-[11px] uppercase tracking-[0.14em] leading-snug mt-3"
        style={{ color: '#888' }}
      >
        {label}
      </div>
      {detail && (
        <div className="text-xs italic leading-snug mt-2" style={{ color: '#555' }}>
          {detail}
        </div>
      )}
    </div>
  )
}
