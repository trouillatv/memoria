'use client'

// Slice E.1 — Composant interactif preview rapport mensuel.
//
// Doctrine impérative anti-rapport bullshit V4 :
//   - AUCUN texte généré IA dans le rendu.
//   - AUCUN score qualité — uniquement compteurs et deltas numériques bruts.
//   - AUCUN nom d'agent (anonymisation totale, héritée des helpers DB).
//   - Compteurs, dates, listes uniquement. La note libre est la SEULE
//     prose du rapport — et elle vient du DG, pas de l'IA.
//
// Composé de sections sobres B2B :
//   1. Indicateurs du mois (4 cards stats)
//   2. Boucle de preuve (segments visualisés)
//   3. Sélection photos (grid, 6 pré-sélectionnées, cap 12)
//   4. Anomalies résolues (liste factuelle)
//   5. Anomalies encore ouvertes (liste factuelle)
//   6. Capital cumulé depuis début contrat
//   7. Note libre DG (300 chars max, optionnelle)
//   8. Bouton "Approuver et préparer le partage" (action E.2)

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Download, ExternalLink, Eye, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type {
  MonthlyReportData,
  ReportAnomalyEntry,
  ReportPhotoCandidate,
  ReportSegmentScores,
} from '@/lib/db/monthly-report'
import { approveAndPrepareReportAction } from './actions'

const NOTE_MAX = 300
const PHOTOS_DEFAULT = 6
const PHOTOS_CAP = 12

interface MonthlyReportEditorProps {
  data: MonthlyReportData
  contractId: string
  month: string
  /** MC-6 — Dernière note du DG (mois précédent approuvé) pour pré-remplissage. */
  previousNote?: { month: string; note: string } | null
}

const MONTHS_FR_FULL = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function formatMonthFr(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return yyyymm
  return `${MONTHS_FR_FULL[m - 1]} ${y}`
}

export function MonthlyReportEditor({ data, contractId, month, previousNote }: MonthlyReportEditorProps) {
  // Pré-sélection par défaut : les PHOTOS_DEFAULT premières candidates.
  // L'algorithme côté helper place déjà en tête les photos avec caption non
  // vide puis applique la diversité site, donc cette tranche est "intelligente"
  // par construction.
  const defaultSelected = useMemo<Set<string>>(() => {
    const set = new Set<string>()
    for (const p of data.photoCandidates.slice(0, PHOTOS_DEFAULT)) {
      set.add(p.id)
    }
    return set
  }, [data.photoCandidates])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(defaultSelected)
  const [note, setNote] = useState<string>('')
  const [isPending, startTransition] = useTransition()
  // MC-5 — Preview dialog : Patrick voit le rapport sans créer de share token.
  const [previewOpen, setPreviewOpen] = useState(false)

  // Slice E.2 — dialog "Rapport prêt" affichant les URLs après approbation.
  const [readyDialog, setReadyDialog] = useState<{
    shareUrl: string
    pdfUrl: string
    expiresAt: string
  } | null>(null)

  function toggle(photoId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(photoId)) {
        next.delete(photoId)
      } else {
        if (next.size >= PHOTOS_CAP) {
          toast.info(`Limite ${PHOTOS_CAP} photos par rapport.`)
          return current
        }
        next.add(photoId)
      }
      return next
    })
  }

  function handleApprove() {
    if (selectedIds.size < 1) {
      toast.error('Sélectionnez au moins une photo.')
      return
    }
    startTransition(async () => {
      const res = await approveAndPrepareReportAction({
        contractId,
        month,
        selectedPhotoIds: Array.from(selectedIds),
        note: note.trim(),
      })
      if (!res.ok || !res.shareUrl || !res.pdfUrl || !res.expiresAt) {
        toast.error(res.error ?? 'Erreur lors de la préparation du rapport.')
        return
      }
      toast.success('Rapport prêt — lien valable 30 jours.')
      setReadyDialog({
        shareUrl: res.shareUrl,
        pdfUrl: res.pdfUrl,
        expiresAt: res.expiresAt,
      })
    })
  }

  return (
    <div className="space-y-6">
      <IndicatorsSection data={data} />
      <ProofLoopSection scores={data.segmentScores} />
      <PhotoSelectionSection
        photos={data.photoCandidates}
        selectedIds={selectedIds}
        onToggle={toggle}
      />
      <AnomaliesResolvedSection anomalies={data.anomaliesResolved} />
      <AnomaliesOpenSection anomalies={data.anomaliesStillOpen} />
      <CumulativeSection data={data} />
      <NoteSection
        note={note}
        onChange={setNote}
        previousNote={previousNote}
      />

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => history.back()} disabled={isPending}>
          Annuler
        </Button>
        <Button
          variant="outline"
          onClick={() => setPreviewOpen(true)}
          disabled={isPending || selectedIds.size < 1}
          title="Aperçu de ce que verra le client"
        >
          <Eye className="size-4" />
          Aperçu
        </Button>
        <Button onClick={handleApprove} disabled={isPending || selectedIds.size < 1}>
          {isPending ? 'Préparation…' : 'Approuver et préparer le partage'}
        </Button>
      </div>

      {/* Slice E.2 — Dialog "Rapport prêt" après approbation */}
      <ReadyDialog
        result={readyDialog}
        onClose={() => setReadyDialog(null)}
      />

      {/* MC-5 — Preview dialog : voir le rapport tel que Sylvie le verra. */}
      <PreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        data={data}
        selectedIds={selectedIds}
        note={note}
        month={month}
      />
    </div>
  )
}

// ----------------------------------------------------------------------------
// Slice E.2 — Dialog "Rapport prêt" (download PDF + copy URL)
// ----------------------------------------------------------------------------

function ReadyDialog({
  result,
  onClose,
}: {
  result: { shareUrl: string; pdfUrl: string; expiresAt: string } | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyShareUrl() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Lien copié dans le presse-papiers')
    } catch {
      toast.error("Impossible de copier — sélectionnez l'URL manuellement.")
    }
  }

  const expiresLabel = result ? formatExpiresAt(result.expiresAt) : ''

  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="size-4 text-emerald-600" aria-hidden />
            Rapport prêt
          </DialogTitle>
          <DialogDescription>
            Téléchargez le PDF horodaté ou partagez le lien public temporaire.
          </DialogDescription>
        </DialogHeader>

        {result && (
          <>
            {/* Download PDF */}
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                PDF horodaté
              </div>
              <a
                href={result.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-start gap-1.5 rounded-lg border border-border bg-background px-2.5 h-8 text-sm font-medium hover:bg-muted hover:text-foreground transition-colors"
              >
                <Download className="size-4" />
                Télécharger le PDF
                <ExternalLink className="ml-auto size-3 opacity-50" />
              </a>
            </div>

            {/* Share URL */}
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Lien public temporaire
              </div>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs"
                  title={result.shareUrl}
                >
                  {result.shareUrl}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyShareUrl}
                  aria-label="Copier le lien"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  <span className="ml-1">{copied ? 'Copié' : 'Copier'}</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Expire {expiresLabel}.</p>
            </div>
          </>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatExpiresAt(iso: string): string {
  try {
    const d = new Date(iso)
    return `le ${d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`
  } catch {
    return ''
  }
}

// ----------------------------------------------------------------------------
// Section : Indicateurs du mois (4 cards)
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
// Section : Boucle de preuve (segments)
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
                    className={cn('h-full rounded-full transition-all', SEGMENT_COLORS[i])}
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
// Section : Sélection photos
// ----------------------------------------------------------------------------

function PhotoSelectionSection({
  photos,
  selectedIds,
  onToggle,
}: {
  photos: ReportPhotoCandidate[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Photos sélectionnées ({selectedIds.size} / {PHOTOS_CAP} max)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Aucune photo disponible pour ce mois.
          </p>
        ) : (
          <>
            <div
              role="list"
              aria-label="Photos candidates"
              className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2"
            >
              {photos.map((p) => {
                const selected = selectedIds.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="listitem"
                    onClick={() => onToggle(p.id)}
                    aria-pressed={selected}
                    aria-label={
                      selected
                        ? `Retirer la photo${p.caption ? ` : ${p.caption}` : ''}`
                        : `Sélectionner la photo${p.caption ? ` : ${p.caption}` : ''}`
                    }
                    className={cn(
                      'relative aspect-square rounded-md overflow-hidden border-2 bg-muted transition-all',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      selected
                        ? 'border-primary ring-1 ring-primary/40'
                        : 'border-border hover:border-muted-foreground/40 opacity-80 hover:opacity-100',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.thumbnail_url ?? p.url}
                      alt={p.caption ?? 'Photo'}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                    <span
                      className={cn(
                        'absolute top-1 left-1 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums',
                        selected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background/90 text-muted-foreground border-border',
                      )}
                      aria-hidden
                    >
                      {selected ? '✓' : ''}
                    </span>
                    {p.site_name && (
                      <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] px-1.5 py-0.5 truncate">
                        {p.site_name}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {photos.length} disponible{photos.length > 1 ? 's' : ''} · cliquez pour
              sélectionner / désélectionner. Limite {PHOTOS_CAP} photos par rapport.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Section : Anomalies résolues ce mois
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

// ----------------------------------------------------------------------------
// Section : Anomalies encore ouvertes
// ----------------------------------------------------------------------------

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
// Section : Capital cumulé depuis début contrat
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
// Section : Note libre DG (optionnelle, 300 chars max)
// ----------------------------------------------------------------------------

function NoteSection({
  note,
  onChange,
  previousNote,
}: {
  note: string
  onChange: (v: string) => void
  previousNote?: { month: string; note: string } | null
}) {
  const remaining = NOTE_MAX - note.length
  // MC-6 — Le link n'apparaît que si une note antérieure existe ET que le
  // champ est vide (sinon ça surprendrait : effacer ce que l'utilisateur a écrit).
  const canReuse = !!previousNote && note.length === 0
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Note du dirigeant (optionnel)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={note}
          onChange={(e) => {
            const v = e.target.value
            // On enforce le cap au niveau du state — pas de submit avec >300.
            onChange(v.length > NOTE_MAX ? v.slice(0, NOTE_MAX) : v)
          }}
          maxLength={NOTE_MAX}
          rows={3}
          placeholder="Votre voix — pas l'IA. Une ligne ou deux suffisent."
          aria-label="Note du dirigeant"
        />
        <div className="flex items-center justify-between gap-2">
          {canReuse ? (
            <button
              type="button"
              onClick={() => onChange(previousNote!.note.slice(0, NOTE_MAX))}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              title={previousNote!.note}
            >
              Reprendre la note de {formatMonthFr(previousNote!.month)}
            </button>
          ) : (
            <span aria-hidden />
          )}
          <p className="text-xs text-muted-foreground tabular-nums">
            {remaining} / {NOTE_MAX}
          </p>
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
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
    })
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

// ----------------------------------------------------------------------------
// MC-5 — Preview dialog : vue client avant approbation
// ----------------------------------------------------------------------------
//
// Doctrine V5 Pilier 4 — Patrick voit ce que Sylvie verra AVANT d'engager
// (réduit l'anxiété du "trou noir post-envoi"). Pas de share token créé.
// Pas de PDF généré. Juste un rendu visuel des éléments-clés : photos
// sélectionnées + note du DG + stats du mois.

function PreviewDialog({
  open,
  onClose,
  data,
  selectedIds,
  note,
  month,
}: {
  open: boolean
  onClose: () => void
  data: MonthlyReportData
  selectedIds: Set<string>
  note: string
  month: string
}) {
  const selectedPhotos = data.photoCandidates.filter((p) => selectedIds.has(p.id))
  const monthLabel = data.period.monthLabel
  // Pour cohérence visuelle avec /p/[token] : on affiche en-tête anonymisé,
  // stats agrégées, photos sélectionnées, note du DG.
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aperçu du rapport</DialogTitle>
          <DialogDescription>
            Ce que verra le client {data.contract.client_name} après votre approbation.
            Aucun lien n&apos;est créé tant que vous n&apos;avez pas cliqué sur
            « Approuver et préparer le partage ».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Sous-header sobre */}
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Document factuel anonymisé · Vérifiable via QR code
          </p>

          {/* Titre */}
          <div>
            <h3 className="text-lg font-semibold">
              Rapport mensuel — {data.contract.client_name}
            </h3>
            <p className="text-xs text-muted-foreground">
              {data.contract.name} · {monthLabel} ({month})
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <PreviewStat n={data.counts.interventionsExecuted} label="interventions" />
            <PreviewStat n={data.counts.photosCount} label="photos" />
            <PreviewStat n={data.counts.anomaliesResolved} label="anomalies résolues" />
            <PreviewStat n={data.counts.validationsCount} label="validations" />
          </div>

          {/* Note DG */}
          {note.trim().length > 0 ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Note du dirigeant
              </div>
              <p className="text-sm whitespace-pre-wrap">{note.trim()}</p>
            </div>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              Aucune note du dirigeant — ce mois-ci sera livré sans message personnel.
            </p>
          )}

          {/* Photos sélectionnées */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Photos partagées ({selectedPhotos.length})
            </div>
            {selectedPhotos.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                Aucune photo sélectionnée.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {selectedPhotos.map((p) => (
                  <div
                    key={p.id}
                    className="relative aspect-square rounded-md overflow-hidden border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.thumbnail_url ?? p.url}
                      alt={p.caption ?? 'Photo'}
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                    />
                    {p.site_name && (
                      <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] px-1.5 py-0.5 truncate">
                        {p.site_name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PreviewStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-xl font-semibold tabular-nums">{n.toLocaleString('fr-FR')}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}
