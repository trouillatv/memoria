// Slice E.2 — Générateur PDF "Rapport mensuel client" (@react-pdf/renderer).
//
// Doctrine impérative anti-rapport bullshit V4 :
//   - AUCUN texte généré IA. Pas de phrase d'interprétation, pas de "résumé".
//   - AUCUN score qualité — uniquement compteurs, dates, photos, note humaine.
//   - AUCUN nom d'agent (anonymisation totale).
//   - La SEULE prose vient du DG (champ dg_note, max 300 chars), c'est SA voix.
//
// Style cohérent avec proof-dossier.tsx (Phase 5) : sobre B2B, même palette,
// même footer fixe (QR + watermark + page X/Y). Le client doit reconnaître la
// signature visuelle entre un dossier de preuves et un rapport mensuel.
//
// Structure 4 pages (numérotées automatiquement par @react-pdf) :
//   1. Couverture + indicateurs + boucle de preuve
//   2. Photos sélectionnées (grid)
//   3. Anomalies (résolues + ouvertes)
//   4. Capital cumulé + note du DG

import React from 'react'
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import type {
  MonthlyReportData,
  ReportAnomalyEntry,
  ReportPhotoCandidate,
} from '@/lib/db/monthly-report'

// ----------------------------------------------------------------------------
// Palette + styles — alignés sur proof-dossier.tsx (cohérence Phase 5).
// ----------------------------------------------------------------------------

const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  surface: '#f8fafc',
  accent: '#4f46e5',
  warn: '#b45309',
  ok: '#059669',
}

const SEGMENT_COLORS = ['#64748b', '#0ea5e9', '#6366f1', '#f59e0b', '#10b981']

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.text,
    paddingTop: 36,
    paddingBottom: 64,
    paddingHorizontal: 36,
    lineHeight: 1.4,
  },

  // Header (top of every "first section" page — on garde un en-tête sobre).
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 8,
    marginBottom: 16,
  },
  headerLeft: { flexDirection: 'column' },
  brand: { fontSize: 12, fontWeight: 700, color: COLORS.accent, letterSpacing: 1 },
  brandSubtitle: { fontSize: 9, color: COLORS.muted, marginTop: 2 },
  headerRight: { fontSize: 9, color: COLORS.muted, textAlign: 'right' },

  // Title cover
  cover: { marginBottom: 16 },
  coverTitle: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  coverSubtitle: { fontSize: 11, color: COLORS.muted },

  // Stats band (4 cards)
  statBand: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
  },
  stat: { width: '25%', paddingHorizontal: 4 },
  statValue: { fontSize: 16, fontWeight: 700, marginTop: 2 },
  statLabel: { fontSize: 8, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6 },

  trendLine: {
    fontSize: 9,
    color: COLORS.muted,
    marginBottom: 14,
  },

  // Sections
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 4,
    marginBottom: 8,
  },
  sectionEmpty: { fontStyle: 'italic', color: COLORS.faint, fontSize: 9 },

  // Boucle de preuve
  loopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  loopCell: { flex: 1, minWidth: 0 },
  loopCellHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  loopCellLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  loopCellValue: { fontSize: 7, color: COLORS.muted },
  loopTrack: {
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  loopFill: { height: 4, borderRadius: 2 },

  // Photos grid (3 colonnes pour les photos sélectionnées)
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  photoItem: { width: '33.33%', padding: 3 },
  photoFrame: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  photoImage: { width: '100%', height: 120, objectFit: 'cover' },
  photoCaption: { fontSize: 8, padding: 4, paddingBottom: 1 },
  photoMeta: { fontSize: 7, color: COLORS.muted, paddingHorizontal: 4, paddingBottom: 4 },

  // Anomalies
  listItem: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: 6,
    marginBottom: 5,
  },
  itemText: { fontSize: 9 },
  itemMeta: { fontSize: 8, color: COLORS.muted, marginTop: 1 },
  anomalyResolved: { borderLeftColor: '#a7f3d0' },
  anomalyOpen: { borderLeftColor: '#fde68a' },

  // Capital cumulé
  cumulativeBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
  },
  cumulativeLine: { fontSize: 10, marginBottom: 4 },
  cumulativeFootnote: { fontSize: 8, color: COLORS.muted },

  // Note du DG
  dgNoteBox: {
    backgroundColor: '#fefce8',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 4,
    padding: 10,
    fontSize: 10,
  },
  dgNoteLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },

  // Footer fixe
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
  footerQr: { width: 40, height: 40, marginRight: 8 },
  footerText: { flexDirection: 'column', flex: 1 },
  footerLabel: { fontSize: 7, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  footerUrl: { fontSize: 8, color: COLORS.accent, marginTop: 1 },
  footerWatermark: { fontSize: 7, color: COLORS.faint, marginTop: 2 },
  pageNumber: { fontSize: 8, color: COLORS.muted },
})

// ----------------------------------------------------------------------------
// Helpers formatage
// ----------------------------------------------------------------------------

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function fmtDayShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  } catch {
    return '—'
  }
}

function fmtDayLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function signed(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `${n}`
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const SEGMENT_LABELS = ['Promis', 'Planifié', 'Exécuté', 'Prouvé', 'Validé'] as const

// ----------------------------------------------------------------------------
// Composant principal
// ----------------------------------------------------------------------------

export interface MonthlyReportPdfProps {
  data: MonthlyReportData
  /** Sélection figée des photos approuvées par le DG. */
  selectedPhotoIds: string[]
  /** Note libre du DG (peut être vide). */
  dgNote: string
  /** QR code en data URL (PNG base64) pointant vers shareUrl. */
  qrDataUrl?: string | null
  /** URL publique du rapport. Affichée en footer. */
  shareUrl?: string | null
  /** Date de génération du PDF (ISO). */
  generatedAt: string
  /** Date d'expiration du token (ISO). */
  expiresAt?: string | null
  /** Nom du tenant si dispo (MemorIA — header). */
  tenantName?: string
}

export function MonthlyReportPdf({
  data,
  selectedPhotoIds,
  dgNote,
  qrDataUrl,
  shareUrl,
  generatedAt,
  expiresAt,
  tenantName,
}: MonthlyReportPdfProps) {
  // On filtre les photos sélectionnées dans l'ordre du dataset (qui respecte
  // l'algorithme du helper : captions d'abord, diversité site, date desc).
  const selectedSet = new Set(selectedPhotoIds)
  const selectedPhotos = data.photoCandidates.filter((p) => selectedSet.has(p.id))

  const monthLabel = capitalize(data.period.monthLabel)
  const t = data.trend
  const c = data.cumulative
  const segValues = [
    data.segmentScores.promised,
    data.segmentScores.planned,
    data.segmentScores.executed,
    data.segmentScores.proven,
    data.segmentScores.validated,
  ]

  return (
    <Document
      title={`Rapport mensuel — ${data.contract.name} — ${monthLabel}`}
      author="MemorIA"
      subject="Rapport mensuel client"
      creator="MemorIA — Rapport mensuel"
    >
      {/* ---------------------------------------------------------------- */}
      {/* Page 1 — Couverture + indicateurs + boucle de preuve              */}
      {/* ---------------------------------------------------------------- */}
      <Page size="A4" style={styles.page}>
        <PdfHeader
          tenantName={tenantName}
          generatedAt={generatedAt}
          expiresAt={expiresAt}
        />

        <View style={styles.cover}>
          <Text style={styles.coverTitle}>Rapport mensuel — {data.contract.name}</Text>
          <Text style={styles.coverSubtitle}>
            {data.contract.client_name} · {monthLabel}
          </Text>
        </View>

        {/* 4 stats sobres */}
        <View style={styles.statBand}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Interventions</Text>
            <Text style={styles.statValue}>{data.counts.interventionsExecuted}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Photos</Text>
            <Text style={styles.statValue}>{data.counts.photosCount}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Anom. résolues</Text>
            <Text style={styles.statValue}>{data.counts.anomaliesResolved}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Validations</Text>
            <Text style={styles.statValue}>{data.counts.validationsCount}</Text>
          </View>
        </View>

        <Text style={styles.trendLine}>
          vs mois précédent : {signed(t.interventionsDelta)} interv. ·{' '}
          {signed(t.photosDelta)} photos · {signed(t.anomaliesOpenDelta)} anomalies ouvertes
        </Text>

        {/* Boucle de preuve */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Boucle de preuve</Text>
          <View style={styles.loopRow}>
            {segValues.map((v, i) => {
              const pct = Math.max(0, Math.min(1, v))
              return (
                <View key={i} style={styles.loopCell}>
                  <View style={styles.loopCellHeader}>
                    <Text style={styles.loopCellLabel}>{SEGMENT_LABELS[i]}</Text>
                    <Text style={styles.loopCellValue}>{Math.round(pct * 100)}%</Text>
                  </View>
                  <View style={styles.loopTrack}>
                    <View
                      style={[
                        styles.loopFill,
                        {
                          width: `${pct * 100}%`,
                          backgroundColor: SEGMENT_COLORS[i] ?? COLORS.accent,
                        },
                      ]}
                    />
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        <PdfFooter
          qrDataUrl={qrDataUrl}
          shareUrl={shareUrl}
          generatedAt={generatedAt}
        />
      </Page>

      {/* ---------------------------------------------------------------- */}
      {/* Page 2 — Photos sélectionnées par le DG                          */}
      {/* ---------------------------------------------------------------- */}
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Photos sélectionnées ({selectedPhotos.length})
          </Text>
          {selectedPhotos.length === 0 ? (
            <Text style={styles.sectionEmpty}>Aucune photo sélectionnée.</Text>
          ) : (
            <View style={styles.photoGrid}>
              {selectedPhotos.map((p) => (
                <PhotoCell key={p.id} photo={p} />
              ))}
            </View>
          )}
        </View>

        <PdfFooter
          qrDataUrl={qrDataUrl}
          shareUrl={shareUrl}
          generatedAt={generatedAt}
        />
      </Page>

      {/* ---------------------------------------------------------------- */}
      {/* Page 3 — Anomalies (résolues + ouvertes)                         */}
      {/* ---------------------------------------------------------------- */}
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Anomalies résolues ce mois ({data.anomaliesResolved.length})
          </Text>
          {data.anomaliesResolved.length === 0 ? (
            <Text style={styles.sectionEmpty}>Aucune anomalie résolue ce mois.</Text>
          ) : (
            data.anomaliesResolved.map((a) => (
              <AnomalyItem key={a.id} anomaly={a} resolved />
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Anomalies encore ouvertes ({data.anomaliesStillOpen.length})
          </Text>
          {data.anomaliesStillOpen.length === 0 ? (
            <Text style={styles.sectionEmpty}>Aucune anomalie ouverte en fin de mois.</Text>
          ) : (
            data.anomaliesStillOpen.map((a) => (
              <AnomalyItem key={a.id} anomaly={a} resolved={false} />
            ))
          )}
        </View>

        <PdfFooter
          qrDataUrl={qrDataUrl}
          shareUrl={shareUrl}
          generatedAt={generatedAt}
        />
      </Page>

      {/* ---------------------------------------------------------------- */}
      {/* Page 4 — Continuité + Capital cumulé + note du DG                 */}
      {/* ---------------------------------------------------------------- */}
      <Page size="A4" style={styles.page}>
        {/* Sprint 5 UX-9 — Continuité du service (Doctrine V5).
            Compteurs factuels passifs. Argument commercial par l'évidence. */}
        {data.continuity && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Continuité du service</Text>
            <View style={styles.cumulativeBox}>
              <Text style={styles.cumulativeLine}>
                {data.continuity.daysSinceStart.toLocaleString('fr-FR')} jour
                {data.continuity.daysSinceStart > 1 ? 's' : ''} depuis le démarrage du contrat
              </Text>
              <Text style={styles.cumulativeLine}>
                {data.continuity.consecutiveMonthsWithIntervention} mois consécutif
                {data.continuity.consecutiveMonthsWithIntervention > 1 ? 's' : ''} couvert
                {data.continuity.consecutiveMonthsWithIntervention > 1 ? 's' : ''}
              </Text>
              <Text style={styles.cumulativeLine}>
                {data.continuity.weeksWithoutInterruption} semaine
                {data.continuity.weeksWithoutInterruption > 1 ? 's' : ''} sans interruption
              </Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Capital cumulé depuis le {fmtDayLong(data.contract.start_date)}
          </Text>
          <View style={styles.cumulativeBox}>
            <Text style={styles.cumulativeLine}>
              {c.totalInterventionsExecuted.toLocaleString('fr-FR')} interventions documentées
            </Text>
            <Text style={styles.cumulativeLine}>
              {c.totalPhotos.toLocaleString('fr-FR')} photos archivées
            </Text>
            <Text style={styles.cumulativeLine}>
              {c.totalAnomaliesResolved.toLocaleString('fr-FR')} incidents traités
            </Text>
            <Text style={styles.cumulativeFootnote}>
              {c.daysSinceStart} jour{c.daysSinceStart > 1 ? 's' : ''} de prestation.
            </Text>
          </View>
        </View>

        {dgNote.trim().length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Note du dirigeant</Text>
            <View style={styles.dgNoteBox}>
              <Text style={styles.dgNoteLabel}>Mot du DG · {data.contract.client_name}</Text>
              <Text>{dgNote}</Text>
            </View>
          </View>
        )}

        <PdfFooter
          qrDataUrl={qrDataUrl}
          shareUrl={shareUrl}
          generatedAt={generatedAt}
        />
      </Page>
    </Document>
  )
}

// ----------------------------------------------------------------------------
// Sous-composants
// ----------------------------------------------------------------------------

// Slice S1 — Doctrine V5 Pilier 6 « Infrastructure invisible ».
// Le hero visuel = le prestataire (tenantName en gros). MemorIA passe en
// footer ("Infrastructure : MemorIA"). Le client doit reconnaître son
// prestataire en premier, l'outil en second.
function PdfHeader({
  tenantName,
  generatedAt,
  expiresAt,
}: {
  tenantName?: string
  generatedAt: string
  expiresAt?: string | null
}) {
  const displayName = (tenantName ?? '').trim() || 'Votre entreprise'
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={styles.brand}>{displayName.toUpperCase()}</Text>
        <Text style={styles.brandSubtitle}>Rapport mensuel</Text>
      </View>
      <View style={styles.headerRight}>
        <Text>Généré le {fmtDateTime(generatedAt)}</Text>
        {expiresAt && <Text>Lien valable jusqu&apos;au {fmtDateTime(expiresAt)}</Text>}
      </View>
    </View>
  )
}

function PhotoCell({ photo }: { photo: ReportPhotoCandidate }) {
  return (
    <View style={styles.photoItem} wrap={false}>
      <View style={styles.photoFrame}>
        {photo.url ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={photo.url} style={styles.photoImage} />
        ) : (
          <View style={[styles.photoImage, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={styles.sectionEmpty}>(image indisponible)</Text>
          </View>
        )}
        {photo.caption && photo.caption.trim().length > 0 && (
          <Text style={styles.photoCaption}>{photo.caption}</Text>
        )}
        <Text style={styles.photoMeta}>
          {photo.site_name ? `${photo.site_name} · ` : ''}
          {fmtDayShort(photo.taken_at)}
        </Text>
      </View>
    </View>
  )
}

function AnomalyItem({
  anomaly,
  resolved,
}: {
  anomaly: ReportAnomalyEntry
  resolved: boolean
}) {
  return (
    <View
      style={[styles.listItem, resolved ? styles.anomalyResolved : styles.anomalyOpen]}
      wrap={false}
    >
      <Text style={styles.itemText}>{anomaly.description}</Text>
      <Text style={styles.itemMeta}>
        {resolved
          ? `Résolue ${fmtDayShort(anomaly.resolved_at)}`
          : `Signalée ${fmtDayShort(anomaly.reported_at)}`}
        {anomaly.site_name ? ` · ${anomaly.site_name}` : ''}
      </Text>
    </View>
  )
}

function PdfFooter({
  qrDataUrl,
  shareUrl,
  generatedAt,
}: {
  qrDataUrl?: string | null
  shareUrl?: string | null
  generatedAt: string
}) {
  return (
    <View style={styles.footer} fixed>
      {qrDataUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={qrDataUrl} style={styles.footerQr} />
      ) : null}
      <View style={styles.footerText}>
        <Text style={styles.footerLabel}>Document horodaté · Vérifiable</Text>
        {shareUrl ? (
          <Text style={styles.footerUrl}>{shareUrl}</Text>
        ) : (
          <Text style={styles.footerUrl}>Lien public non encore généré</Text>
        )}
        <Text style={styles.footerWatermark}>
          Infrastructure : MemorIA · Généré le {fmtDateTime(generatedAt)}
        </Text>
      </View>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
        fixed
      />
    </View>
  )
}
