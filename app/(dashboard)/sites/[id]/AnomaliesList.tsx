import type { SiteAnomalyEntry } from '@/lib/db/site-cockpit'
import { SectionTitle } from './SectionTitle'

/**
 * V5.1.3 — Section 4 : ANOMALIES / CICATRICES
 *
 * Bordure-gauche persistante même après résolution. Gradient :
 *   - Open < 14j     : 3px solid #0a0a0a (vif, ici-maintenant)
 *   - Open >= 14j    : 2px solid #555    (présent qui s'installe)
 *   - Resolved < 90j : 1.5px solid #888  (cicatrice fraîche)
 *   - Resolved >= 90j: 1px solid #c0c0c0 (cicatrice ancienne)
 *   - Ignored        : 1px solid #e8e8e8 (presque transparente)
 *
 * Tri : open d'abord (récent → ancien), puis resolved (récent → ancien),
 * puis ignored.
 *
 * PIÈGES À ÉVITER :
 *   ❌ "Aucune anomalie active" en empty state → félicitation implicite
 *   ✅ "Aucune anomalie ouverte sur ce site"
 *   ❌ pastille rouge / badge URGENT
 *   ❌ classement par "gravité"
 */

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function statusLabel(anomaly: SiteAnomalyEntry): string {
  if (anomaly.status === 'open') return `ouverte ${formatDateShort(anomaly.createdAt)}`
  if (anomaly.status === 'ignored') return `ignorée ${formatDateShort(anomaly.createdAt)}`
  if (anomaly.resolvedAt) return `résolue ${formatDateShort(anomaly.resolvedAt)}`
  return 'résolue'
}

function borderStyle(anomaly: SiteAnomalyEntry): {
  borderLeftWidth: number
  borderLeftStyle: 'solid'
  borderLeftColor: string
  opacity: number
} {
  if (anomaly.status === 'open') {
    if (anomaly.ageDays < 14) {
      return { borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: '#0a0a0a', opacity: 1 }
    }
    return { borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: '#555', opacity: 0.9 }
  }
  if (anomaly.status === 'resolved') {
    if (anomaly.ageDays < 90) {
      return { borderLeftWidth: 1.5, borderLeftStyle: 'solid', borderLeftColor: '#888', opacity: 0.7 }
    }
    return { borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: '#c0c0c0', opacity: 0.55 }
  }
  return { borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: '#e8e8e8', opacity: 0.45 }
}

function sortAnomalies(anomalies: SiteAnomalyEntry[]): SiteAnomalyEntry[] {
  const priority = (a: SiteAnomalyEntry) =>
    a.status === 'open' ? 0 : a.status === 'resolved' ? 1 : 2
  return [...anomalies].sort((a, b) => {
    const dp = priority(a) - priority(b)
    if (dp !== 0) return dp
    const aDate = a.resolvedAt ?? a.createdAt
    const bDate = b.resolvedAt ?? b.createdAt
    return bDate.localeCompare(aDate)
  })
}

export function AnomaliesList({ anomalies }: { anomalies: SiteAnomalyEntry[] }) {
  if (anomalies.length === 0) {
    return (
      <section className="space-y-4">
        <SectionTitle>Anomalies</SectionTitle>
        <p className="text-sm italic" style={{ color: '#888' }}>
          Aucune anomalie ouverte sur ce site.
        </p>
      </section>
    )
  }

  const sorted = sortAnomalies(anomalies).slice(0, 12)

  return (
    <section className="space-y-2">
      <SectionTitle>Anomalies</SectionTitle>
      <ol className="pt-2 space-y-3">
        {sorted.map((a) => {
          const border = borderStyle(a)
          const paddingLeft = border.borderLeftWidth + 12
          return (
            <li
              key={a.id}
              className="py-1"
              style={{
                opacity: border.opacity,
                borderLeftWidth: border.borderLeftWidth,
                borderLeftStyle: border.borderLeftStyle,
                borderLeftColor: border.borderLeftColor,
                paddingLeft,
              }}
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="text-[15px] leading-snug" style={{ color: '#0a0a0a' }}>
                  {a.description}
                </span>
                <span
                  className="text-[12px] tabular-nums shrink-0"
                  style={{ color: '#888' }}
                >
                  {statusLabel(a)}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
