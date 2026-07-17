import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import type { SiteAnomalyEntry, SiteMemoryMeta } from '@/lib/db/site-cockpit'

/**
 * V5.1.4 — Anomalies, pattern shadcn cohérent.
 *
 * Doctrine produit (reste valide) :
 *   ❌ pas de classement par "gravité"
 *   ❌ pas de pastille rouge / URGENT
 *   ✅ empty state factuel : "Aucune anomalie ouverte sur ce site"
 *
 * Photo : pièce de dossier latérale, couleur native, jamais hero image,
 * jamais crop (object-contain). "Mémoire opérationnelle, ni marketing ni
 * preuve juridique."
 */

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function dateLabel(anomaly: SiteAnomalyEntry): string {
  if (anomaly.status === 'open') return `signalée ${formatDateShort(anomaly.createdAt)}`
  if (anomaly.status === 'ignored') return `ignorée ${formatDateShort(anomaly.createdAt)}`
  if (anomaly.resolvedAt) return `résolue ${formatDateShort(anomaly.resolvedAt)}`
  return ''
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

function AnomalyItem({ a }: { a: SiteAnomalyEntry }) {
  const isResolved = a.status === 'resolved'
  const isIgnored = a.status === 'ignored'
  return (
    <li
      className={`rounded border bg-card p-3 flex items-start gap-3 ${
        isIgnored ? 'opacity-60' : isResolved ? 'opacity-80' : ''
      }`}
    >
      <AlertTriangle
        className={`h-4 w-4 shrink-0 mt-0.5 ${
          a.status === 'open' ? 'text-amber-600' : 'text-muted-foreground'
        }`}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <span className="text-sm font-medium">{a.description}</span>
          <StatusBadge status={a.status} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{dateLabel(a)}</p>
      </div>
      {a.photoUrl && (
        <Link
          href={`/interventions/${a.interventionId}`}
          className="shrink-0 block"
          aria-label="Voir l'intervention source"
        >
          <img
            src={a.photoUrl}
            alt=""
            className="block h-[72px] w-24 rounded border bg-muted object-contain"
          />
        </Link>
      )}
    </li>
  )
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </h3>
  )
}

function formatMonthYear(iso: string): string {
  const d = new Date(iso)
  const m = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return m.charAt(0).toUpperCase() + m.slice(1)
}

export function AnomaliesList({
  anomalies,
  meta,
}: {
  anomalies: SiteAnomalyEntry[]
  meta?: SiteMemoryMeta
}) {
  // V5.1.4 — Séparation explicite Ouvertes / Cicatrisées (Vincent 2026-05-15).
  // L'anomalie cicatrisée reste visible — c'est la mémoire du lieu. Mais elle
  // est dissociée des anomalies actives pour clarifier la lecture opérationnelle.
  const sorted = sortAnomalies(anomalies)
  const open = sorted.filter((a) => a.status === 'open').slice(0, 12)
  const healed = sorted.filter((a) => a.status === 'resolved' || a.status === 'ignored').slice(0, 6)

  // Empty state lieu-centric : si pas d'anomalies du tout, on parle de la mémoire.
  if (anomalies.length === 0) {
    if (meta?.lastHealed) {
      return (
        <p className="text-sm text-muted-foreground">
          Aucune anomalie ouverte.{' '}
          <span className="italic">
            Dernière cicatrice : {meta.lastHealed.description.toLowerCase()},
            résolue en {formatMonthYear(meta.lastHealed.resolvedAt).toLowerCase()}.
          </span>
        </p>
      )
    }
    return (
      <p className="text-sm text-muted-foreground italic">
        Aucune anomalie ouverte sur ce chantier.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {open.length > 0 ? (
        <div>
          <SubHeader>Ouvertes ({open.length})</SubHeader>
          <ul className="space-y-1.5">
            {open.map((a) => (
              <AnomalyItem key={a.id} a={a} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Aucune anomalie ouverte actuellement.
          {meta?.lastHealed && (
            <span className="italic">
              {' '}
              Dernière cicatrice : {meta.lastHealed.description.toLowerCase()},
              résolue en {formatMonthYear(meta.lastHealed.resolvedAt).toLowerCase()}.
            </span>
          )}
        </p>
      )}

      {healed.length > 0 && (
        <div>
          <SubHeader>Cicatrisées</SubHeader>
          <ul className="space-y-1.5">
            {healed.map((a) => (
              <AnomalyItem key={a.id} a={a} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
