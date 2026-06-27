// /admin/test-terrain — monitoring du test terrain (module Visite + « Fait aujourd'hui »).
// Lecture seule, observation PRODUIT (le module est-il utilisé ?), jamais RH.
// Temporaire : à retirer quand le test est clos.

import Link from 'next/link'
import { getTerrainTestSnapshot } from '@/lib/db/test-terrain-monitor'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  photo: '📷 Photo',
  vocal: '🎤 Vocal',
  note: '📝 Note',
  verification: '🎯 Vérification',
  position: '📍 Position',
}

function rel(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return "à l'instant"
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Stat({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className={`text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
    </div>
  )
}

export default async function AdminTestTerrainPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const { days: daysRaw } = await searchParams
  const days = Number(daysRaw) === 30 ? 30 : Number(daysRaw) === 1 ? 1 : 7
  const s = await getTerrainTestSnapshot(days)

  const totalVisit = s.visits.started
  const noActivity = totalVisit === 0 && s.captures.total === 0 && s.actions.doneToday === 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Test terrain</h1>
          <p className="text-sm text-muted-foreground">
            Le module Visite et « Fait aujourd&apos;hui » sont-ils utilisés&nbsp;? Observation produit, pas RH.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {[1, 7, 30].map((d) => (
            <Link
              key={d}
              href={`/admin/test-terrain${d !== 7 ? `?days=${d}` : ''}`}
              aria-current={d === days ? 'page' : undefined}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                d === days ? 'border-brand-600 bg-brand-50 font-medium text-brand-900 dark:bg-brand-950/30 dark:text-brand-200'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {d === 1 ? "aujourd'hui" : `${d} j`}
            </Link>
          ))}
        </div>
      </div>

      {noActivity && (
        <p className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          Aucune activité du module sur la période — le conducteur n&apos;a pas (encore) démarré de visite ni marqué d&apos;action.
        </p>
      )}

      {/* Visites */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Visites</h2>
        <div className="grid grid-cols-3 gap-3">
          <Stat value={s.visits.started} label="démarrées" />
          <Stat value={s.visits.ongoing} label="en cours" tone={s.visits.ongoing > 0 ? 'text-emerald-600' : ''} />
          <Stat value={s.visits.ended} label="terminées" />
        </div>
      </section>

      {/* Captures */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Captures terrain <span className="text-muted-foreground/60">· {s.captures.total} au total</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(['photo', 'vocal', 'note', 'verification', 'position'] as const).map((k) => (
            <Stat key={k} value={s.captures.byKind[k] ?? 0} label={KIND_LABEL[k]} />
          ))}
        </div>
        {(s.transcription.pending + s.transcription.done + s.transcription.failed) > 0 && (
          <p className="text-xs text-muted-foreground">
            Transcription vocale : <span className="font-medium text-foreground">{s.transcription.done}</span> faite
            {s.transcription.pending > 0 ? ` · ${s.transcription.pending} en cours` : ''}
            {s.transcription.failed > 0 ? ` · ${s.transcription.failed} échouée(s)` : ''}.
          </p>
        )}
      </section>

      {/* Débrief (tri) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Débrief — tri des captures</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat value={s.triage.captured} label="non triées" tone={s.triage.captured > 0 ? 'text-amber-600' : ''} />
          <Stat value={s.triage.kept} label="gardées" />
          <Stat value={s.triage.discarded} label="ignorées" />
          <Stat value={s.triage.toAction} label="à traiter" />
          <Stat value={s.triage.toFollow} label="à suivre" />
        </div>
      </section>

      {/* Actions « Fait aujourd'hui » */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat value={s.actions.doneToday} label="marquées « fait aujourd'hui » (aujourd'hui)" tone={s.actions.doneToday > 0 ? 'text-emerald-600' : ''} />
          <Stat value={s.actions.treated} label={`définitivement traitées (${days === 1 ? "aujourd'hui" : `${days} j`})`} />
        </div>
      </section>

      {/* Pouls — dernières captures */}
      {s.recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Dernières captures</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {s.recent.map((r, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-28 shrink-0">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.site}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{rel(r.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
