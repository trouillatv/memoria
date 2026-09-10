// P6 — Détail d'un run Live Writer reconstruit (drill-down depuis /admin/live-writer).
// Lecture SEULE. Bornes from/to = celles du run reconstruit (heuristique), pas un id stocké.

import Link from 'next/link'
import {
  getLiveWriterRunEvents,
  type LiveWriterSourceKind,
} from '@/lib/db/tracked-point-live-writer-observability'
import type { ReconcileVerdict, ReconcileWritePattern } from '@/lib/db/tracked-point-live-writer'

export const dynamic = 'force-dynamic'

const VERDICT_LABEL: Record<ReconcileVerdict, string> = {
  AUTO_CREATED: 'Créé auto',
  AUTO_LINKED: 'Lié auto',
  NEEDS_HUMAN: 'À arbitrer',
  IGNORED_NOT_TRACKABLE: 'Ignoré (non suivable)',
}

const WRITE_PATTERN_LABEL: Record<ReconcileWritePattern, string> = {
  CREATE_POINT_WITH_MEMBERSHIP_AND_CBO_LINK: 'Création point + membre + lien CBO',
  CREATE_POINT_WITH_MEMBERSHIP: 'Création point + membre',
  ATTACH_MEMBER: 'Rattachement à un point existant',
  ENRICH_EXISTING_POINT: 'Enrichissement point existant',
  CREATE_PENDING_TRACE: 'Trace en attente créée',
  CREATE_CANDIDATES: 'Candidats créés',
  NOOP: 'Rejeu (aucun effet)',
  IGNORE_NOT_TRACKABLE: 'Ignoré (non suivable)',
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

function isSourceKind(v: string | undefined): v is LiveWriterSourceKind {
  return v === 'historical_pdf' || v === 'field_visit' || v === 'meeting'
}

export default async function AdminLiveWriterDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; sourceKind?: string; sourceRefId?: string; from?: string; to?: string }>
}) {
  const { site, sourceKind, sourceRefId, from, to } = await searchParams

  if (!site || !isSourceKind(sourceKind) || !from || !to) {
    return (
      <div className="space-y-4">
        <Link href="/admin/live-writer" className="text-xs text-brand-700 hover:underline dark:text-brand-300">← Retour</Link>
        <p className="text-sm text-destructive">Paramètres de run manquants ou invalides.</p>
      </div>
    )
  }

  const events = await getLiveWriterRunEvents({
    siteId: site,
    sourceKind,
    sourceRefId: sourceRefId ?? null,
    from,
    to,
  })

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/live-writer" className="text-xs text-brand-700 hover:underline dark:text-brand-300">← Retour</Link>
        <h1 className="mt-2 text-2xl font-semibold">Détail du run</h1>
        <p className="text-sm text-muted-foreground">
          {fmtDateTime(from)} → {fmtDateTime(to)} · {events.length} événement{events.length > 1 ? 's' : ''}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Heure</th>
              <th className="px-3 py-2 text-left">Unité</th>
              <th className="px-3 py-2 text-left">Verdict</th>
              <th className="px-3 py-2 text-left">Écriture</th>
              <th className="px-3 py-2 text-left">Point cible</th>
              <th className="px-3 py-2 text-left">Rejeu</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {events.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">Aucun événement.</td></tr>
            ) : events.map((ev) => (
              <tr key={ev.id} className="hover:bg-muted/20">
                <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDateTime(ev.occurredAt)}</td>
                <td className="px-3 py-2 font-mono text-xs">{ev.unitKey}</td>
                <td className="px-3 py-2 text-xs">{VERDICT_LABEL[ev.verdict]}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{WRITE_PATTERN_LABEL[ev.writePattern]}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{ev.targetPointId ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{ev.replayed ? 'Oui' : 'Non'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
