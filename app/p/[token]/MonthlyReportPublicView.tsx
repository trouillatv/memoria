// Slice E.2 — Vue publique du rapport mensuel (server component).
//
// Doctrine impérative anti-rapport bullshit V4 :
//   - AUCUN texte généré IA. Aucune phrase d'interprétation.
//   - AUCUN score qualité. Compteurs, deltas, dates, photos uniquement.
//   - AUCUN nom d'agent (anonymisation totale, héritée du helper DB).
//   - La SEULE prose est la note du DG, figée au moment de l'approbation.
//
// Différences vs MonthlyReportEditor (Slice E.1) :
//   - Read-only : pas de checkboxes, pas de textarea.
//   - Affiche UNIQUEMENT les photos sélectionnées (pas toutes les candidates).
//   - Affiche la note du DG si présente.
//   - Bouton "Télécharger le PDF" → /p/[token]/pdf.
//
// Le layout app/p/[token]/layout.tsx wrap déjà avec un header MemorIA sobre
// et un container max-w-4xl — on rend juste le contenu intérieur.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ReadingCard } from '@/components/ui/reading-card'
import { Button } from '@/components/ui/button'
import { Clock, ShieldCheck, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  MonthlyReportData,
  ReportAnomalyEntry,
  ReportPhotoCandidate,
  ReportSegmentScores,
} from '@/lib/db/monthly-report'
import type { ProofShareToken } from '@/lib/db/proof-share'

interface MonthlyReportPublicViewProps {
  token: string
  shareToken: ProofShareToken
  reportData: MonthlyReportData
  selectedPhotoIds: string[]
  dgNote: string
  /**
   * V5.1.4 — Strophe descriptive du mois (Vincent 2026-05-15).
   * Phrases factuelles extraites algorithmiquement (Résonances / Persistances /
   * Absences) — 3 max. ZÉRO titre technique côté client. Le client doit
   * RESSENTIR que le système se souvient, jamais voir qu'on lui montre une
   * "feature IA". Pas de mention "Résonances/Persistances/IA". Juste 3 phrases.
   */
  siteReadingTexts?: string[]
}

export function MonthlyReportPublicView({
  token,
  shareToken,
  reportData,
  selectedPhotoIds,
  dgNote,
  siteReadingTexts = [],
}: MonthlyReportPublicViewProps) {
  // On filtre les photos sélectionnées dans l'ordre du dataset (déjà
  // priorisé par le helper : captions d'abord, diversité site, date desc).
  const selectedSet = new Set(selectedPhotoIds)
  const selectedPhotos = reportData.photoCandidates.filter((p) => selectedSet.has(p.id))

  const expirationLabel = new Date(shareToken.expires_at).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="space-y-6">
      {/* Sous-header sobre — confidentialité anonymisée par défaut */}
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        Document factuel anonymisé · Vérifiable via QR code
      </p>

      {/* Titre + sous-titre */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">
          Rapport mensuel — {reportData.contract.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {reportData.contract.client_name} · {capitalize(reportData.period.monthLabel)}
        </p>
      </div>

      {/* Indicateurs */}
      <IndicatorsSection data={reportData} />

      {/* Boucle de preuve */}
      <ProofLoopSection scores={reportData.segmentScores} />

      {/* Photos sélectionnées */}
      <SelectedPhotosSection photos={selectedPhotos} />

      {/* Anomalies résolues + ouvertes */}
      <AnomaliesResolvedSection anomalies={reportData.anomaliesResolved} />
      <AnomaliesOpenSection anomalies={reportData.anomaliesStillOpen} />

      {/* Capital cumulé */}
      <CumulativeSection data={reportData} />

      {/* Note du DG (read-only) */}
      {dgNote.trim().length > 0 && (
        <DgNoteSection note={dgNote} clientName={reportData.contract.client_name} />
      )}

      {/* V5.2 — Mémoire du lieu : lectures IA avec identité visuelle cognition.
          Wording "Mémoire du lieu" côté client (pas "Lecture" ni mention IA).
          Max 3 fragments. Frags non disponibles ici (string[] uniquement). */}
      {siteReadingTexts.length > 0 && (
        <div className="space-y-3">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-reading-label/65">
            Mémoire du lieu
          </div>
          {siteReadingTexts.slice(0, 3).map((text, idx) => (
            <ReadingCard key={idx} fragment={text} />
          ))}
        </div>
      )}

      {/* Téléchargement PDF */}
      <Card>
        <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Télécharger le rapport mensuel</h3>
            <p className="text-xs text-muted-foreground">
              PDF horodaté avec QR de vérification.
            </p>
          </div>
          <a href={`/p/${token}/pdf`} target="_blank" rel="noopener noreferrer">
            <Button>
              <Download className="mr-1 h-4 w-4" aria-hidden />
              Télécharger le PDF
            </Button>
          </a>
        </CardContent>
      </Card>

      {/* Footnote expiration */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Lien valable jusqu&apos;au {expirationLabel}
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Section : Indicateurs du mois
// ----------------------------------------------------------------------------

function IndicatorsSection({ data }: { data: MonthlyReportData }) {
  const t = data.trend
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Indicateurs du mois</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCell value={data.counts.interventionsExecuted} label="interventions" />
          <StatCell value={data.counts.photosCount} label="photos" />
          <StatCell value={data.counts.anomaliesResolved} label="anomalies résolues" />
          <StatCell value={data.counts.validationsCount} label="validations" />
        </div>
        <p className="text-xs text-muted-foreground">
          vs mois précédent : {signedNumber(t.interventionsDelta)} interv. ·{' '}
          {signedNumber(t.photosDelta)} photos · {signedNumber(t.anomaliesOpenDelta)} anomalies
          ouvertes
        </p>
      </CardContent>
    </Card>
  )
}

function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString('fr-FR')}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function signedNumber(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

// ----------------------------------------------------------------------------
// Section : Boucle de preuve
// ----------------------------------------------------------------------------

const SEGMENT_LABELS = ['Promis', 'Planifié', 'Exécuté', 'Prouvé', 'Validé'] as const
const SEGMENT_COLORS = [
  'bg-slate-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-amber-500',
  'bg-emerald-500',
] as const

function ProofLoopSection({ scores }: { scores: ReportSegmentScores }) {
  const values = [
    scores.promised,
    scores.planned,
    scores.executed,
    scores.proven,
    scores.validated,
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Boucle de preuve</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {values.map((v, i) => {
            const widthPct = Math.max(0, Math.min(1, v)) * 100
            return (
              <div key={i} className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {SEGMENT_LABELS[i]}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {Math.round(v * 100)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', SEGMENT_COLORS[i])}
                    style={{ width: `${widthPct}%` }}
                    aria-hidden
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Section : Photos sélectionnées (read-only, grid sobre)
// ----------------------------------------------------------------------------

function SelectedPhotosSection({ photos }: { photos: ReportPhotoCandidate[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Photos du mois ({photos.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Aucune photo sélectionnée pour ce rapport.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((p) => (
              <figure
                key={p.id}
                className="rounded-md overflow-hidden border border-border bg-muted/30"
              >
                <div className="aspect-square w-full overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.caption ?? 'Photo'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <figcaption className="px-2 py-1.5 space-y-0.5">
                  {p.caption && p.caption.trim().length > 0 && (
                    <p className="text-xs font-medium truncate">{p.caption}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground truncate">
                    {p.site_name ? `${p.site_name} · ` : ''}
                    {formatDayShort(p.taken_at)}
                  </p>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Section : Anomalies (résolues + ouvertes)
// ----------------------------------------------------------------------------

function AnomaliesResolvedSection({ anomalies }: { anomalies: ReportAnomalyEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Anomalies résolues ce mois ({anomalies.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {anomalies.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Aucune anomalie résolue ce mois.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {anomalies.map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>
                  {a.description}
                  {a.resolved_at && (
                    <span className="text-muted-foreground">
                      {' '}· résolue {formatDayShort(a.resolved_at)}
                    </span>
                  )}
                  {a.site_name && (
                    <span className="text-muted-foreground"> ({a.site_name})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function AnomaliesOpenSection({ anomalies }: { anomalies: ReportAnomalyEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Anomalies encore ouvertes ({anomalies.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {anomalies.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Aucune anomalie ouverte en fin de mois.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {anomalies.map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                <span>
                  {a.description}
                  <span className="text-muted-foreground">
                    {' '}· signalée {formatDayShort(a.reported_at)}
                  </span>
                  {a.site_name && (
                    <span className="text-muted-foreground"> ({a.site_name})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Section : Capital cumulé
// ----------------------------------------------------------------------------

function CumulativeSection({ data }: { data: MonthlyReportData }) {
  const startLabel = formatDayLong(data.contract.start_date)
  const c = data.cumulative
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Capital cumulé depuis le {startLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          <span className="tabular-nums font-semibold">
            {c.totalInterventionsExecuted.toLocaleString('fr-FR')}
          </span>{' '}
          interventions ·{' '}
          <span className="tabular-nums font-semibold">
            {c.totalPhotos.toLocaleString('fr-FR')}
          </span>{' '}
          photos ·{' '}
          <span className="tabular-nums font-semibold">
            {c.totalAnomaliesResolved.toLocaleString('fr-FR')}
          </span>{' '}
          anomalies résolues
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {c.daysSinceStart} jour{c.daysSinceStart > 1 ? 's' : ''} de prestation.
        </p>
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Section : Note du DG (read-only)
// ----------------------------------------------------------------------------

function DgNoteSection({ note, clientName }: { note: string; clientName: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Note du dirigeant</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="text-[10px] uppercase tracking-widest text-amber-900/70 mb-1.5">
            Mot du DG · {clientName}
          </div>
          <p className="whitespace-pre-wrap">{note}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Utils format
// ----------------------------------------------------------------------------

function formatDayShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  } catch {
    return iso
  }
}

function formatDayLong(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
