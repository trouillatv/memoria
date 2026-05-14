import type { RecentActivityItem } from '@/lib/db/site-cockpit'
import { SectionTitle } from './SectionTitle'

/**
 * V5.1.3 — Section 3 : ACTIVITÉ RÉCENTE
 *
 * Colonne respirante. ● (plein 6px, encre noire) vs · (point 3px, gris) =
 * système binaire **présent / passé**, pas évaluatif. Pas de couleurs, pas
 * d'icônes, pas d'avatars.
 *
 * PIÈGES À ÉVITER :
 *   ❌ ajouter trois niveaux ●●● (devient un système de notation)
 *   ❌ ajouter une icône (📷, ⚠️) → bruit visuel SaaS
 *   ❌ tri "par intervenant" → reverse-lookup interdit
 *   ❌ filtre "Tout / Passages / Anomalies" → dilue le sens
 */

const FR_DAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

function formatDateLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 1 && d.getDate() === now.getDate()) return "aujourd'hui"
  if (diffDays === 1 || (diffDays < 2 && d.getDate() !== now.getDate())) return 'hier'
  if (diffDays < 7) return FR_DAYS_SHORT[d.getDay()]
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <section className="space-y-4">
        <SectionTitle>Activité récente</SectionTitle>
        <p className="text-sm italic" style={{ color: '#888' }}>
          Pas d&apos;activité ces 7 derniers jours.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-2">
      <SectionTitle>Activité récente</SectionTitle>
      <ul className="pt-2">
        {items.map((item, idx) => (
          <li
            key={`${item.kind}-${item.id}`}
            className="flex items-start gap-4 py-3"
            style={idx > 0 ? { borderTop: '1px solid #f0f0f0' } : undefined}
          >
            <span
              aria-hidden
              className="shrink-0 rounded-full"
              style={
                item.saliencePrimary
                  ? { width: 6, height: 6, background: '#0a0a0a', marginTop: 9 }
                  : { width: 3, height: 3, background: '#888', marginTop: 11 }
              }
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-[15px] leading-snug" style={{ color: '#0a0a0a' }}>
                  {item.primary}
                </span>
                <span
                  className="text-[12px] tabular-nums shrink-0"
                  style={{ color: '#888' }}
                >
                  {formatDateLabel(item.occurredAt)}
                </span>
              </div>
              {item.secondary && (
                <p
                  className="text-[13px] leading-snug mt-0.5"
                  style={{ color: '#555' }}
                >
                  {item.secondary}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
