// Générateur PDF "Journal du chantier" (@react-pdf/renderer).
//
// Historique exhaustif d'un site : toutes les interventions exécutées ou
// sautées, groupées par jour, avec équipe, participants, photos, anomalies,
// entreprises externes et notes terrain.
//
// Cas d'usage : litige, décennale, passation équipe, audit qualité, client.

import React from 'react'
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import type { JournalEntry, JournalIntervention } from '@/lib/db/site-journal'

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  surface: '#f8fafc',
  accent: '#4f46e5',
  warn: '#b45309',
  ok: '#166534',
  okSurface: '#f0fdf4',
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COLORS.text,
    paddingTop: 36,
    paddingBottom: 52,
    paddingHorizontal: 36,
    lineHeight: 1.4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 8,
    marginBottom: 14,
  },
  brand: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: COLORS.accent, letterSpacing: 0.8 },
  headerRight: { fontSize: 7.5, color: COLORS.muted, textAlign: 'right' },
  siteTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  siteMeta: { fontSize: 8, color: COLORS.muted, marginBottom: 14 },
  dayBlock: { marginBottom: 12 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  dayLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginRight: 8 },
  dayCount: { fontSize: 7.5, color: COLORS.muted },
  dayLine: { flex: 1, height: 0.5, backgroundColor: COLORS.border, marginLeft: 6 },
  card: {
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 3,
    padding: 8,
    marginBottom: 5,
    backgroundColor: COLORS.surface,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  missionName: { fontSize: 9, fontFamily: 'Helvetica-Bold', flex: 1, marginRight: 8 },
  badge: {
    borderWidth: 0.5,
    borderRadius: 2,
    paddingVertical: 1,
    paddingHorizontal: 4,
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 3,
  },
  chip: { fontSize: 7.5, color: COLORS.muted },
  chipAccent: { fontSize: 7.5, color: COLORS.warn },
  companyRow: {
    marginTop: 3,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  companyLabel: { fontSize: 7.5 },
  companyRole: { fontSize: 7.5, color: COLORS.muted },
  notes: {
    marginTop: 4,
    paddingLeft: 6,
    borderLeftWidth: 1.5,
    borderLeftColor: COLORS.border,
    fontSize: 8,
    color: COLORS.muted,
    fontStyle: 'italic',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    paddingTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 7, color: COLORS.faint },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FR_MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const FR_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function formatDayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  const day = FR_DAYS[utc.getUTCDay()]
  return `${day.charAt(0).toUpperCase() + day.slice(1)} ${d} ${FR_MONTHS[m - 1]} ${y}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Pacific/Noumea',
  })
}

const STATUS_LABEL: Record<string, string> = {
  validated: 'Validée',
  completed: 'Exécutée',
  in_progress: 'En cours',
  skipped: 'Sautée',
  planned: 'Planifiée',
}

const STATUS_COLOR: Record<string, string> = {
  validated: COLORS.ok,
  completed: '#065f46',
  in_progress: COLORS.warn,
  skipped: COLORS.muted,
  planned: COLORS.muted,
}

// ---------------------------------------------------------------------------
// InterventionCard
// ---------------------------------------------------------------------------

function InterventionCard({ intv }: { intv: JournalIntervention }) {
  const statusLabel = STATUS_LABEL[intv.status] ?? intv.status
  const statusColor = STATUS_COLOR[intv.status] ?? COLORS.muted

  return (
    <View style={styles.card} wrap={false}>
      <View style={styles.cardRow}>
        <Text style={styles.missionName}>{intv.missionName}</Text>
        <Text style={[styles.badge, { borderColor: statusColor, color: statusColor }]}>
          {statusLabel.toUpperCase()}
        </Text>
      </View>

      <View style={styles.chipsRow}>
        {intv.teamName ? (
          <Text style={styles.chip}>Équipe {intv.teamName}</Text>
        ) : null}
        {intv.participantCount > 0 ? (
          <Text style={styles.chip}>
            {intv.participantCount} participant{intv.participantCount > 1 ? 's' : ''}
          </Text>
        ) : null}
        {intv.photoCount > 0 ? (
          <Text style={styles.chip}>
            {intv.photoCount} photo{intv.photoCount > 1 ? 's' : ''}
          </Text>
        ) : null}
        {intv.anomaliesOpen > 0 ? (
          <Text style={styles.chipAccent}>
            {intv.anomaliesOpen} anomalie{intv.anomaliesOpen > 1 ? 's' : ''} ouverte{intv.anomaliesOpen > 1 ? 's' : ''}
          </Text>
        ) : null}
        {intv.anomaliesResolved > 0 && intv.anomaliesOpen === 0 ? (
          <Text style={[styles.chip, { color: COLORS.ok }]}>
            {intv.anomaliesResolved} résolue{intv.anomaliesResolved > 1 ? 's' : ''}
          </Text>
        ) : null}
      </View>

      {intv.companies.length > 0 ? (
        <View style={styles.companyRow}>
          <Text style={[styles.chip, { marginRight: 2 }]}>Entreprises :</Text>
          {intv.companies.map((c, i) => (
            <Text key={c.id} style={styles.companyLabel}>
              {c.company_name}
              {c.role_description ? (
                <Text style={styles.companyRole}> ({c.role_description})</Text>
              ) : null}
              {i < intv.companies.length - 1 ? ', ' : ''}
            </Text>
          ))}
        </View>
      ) : null}

      {intv.notes ? (
        <View style={styles.notes}>
          <Text>{intv.notes}</Text>
        </View>
      ) : null}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Export principal
// ---------------------------------------------------------------------------

interface Props {
  siteName: string
  clientName: string | null
  address: string | null
  entries: JournalEntry[]
  exportDate: string
}

export function SiteJournalPdf({ siteName, clientName, address, entries, exportDate }: Props) {
  const totalInterventions = entries.reduce((acc, e) => acc + e.interventions.length, 0)

  return (
    <Document
      title={`Journal du chantier — ${siteName}`}
      author="MemorIA"
      creator="MemorIA"
      producer="MemorIA"
    >
      <Page size="A4" style={styles.page}>
        {/* En-tête */}
        <View style={styles.header} fixed>
          <Text style={styles.brand}>MemorIA</Text>
          <Text style={styles.headerRight}>
            Exporté le {exportDate}
          </Text>
        </View>

        {/* Titre site */}
        <Text style={styles.siteTitle}>{siteName}</Text>
        <Text style={styles.siteMeta}>
          {[clientName, address].filter(Boolean).join(' · ')}
          {' · '}
          Journal du chantier — {totalInterventions} intervention{totalInterventions > 1 ? 's' : ''}
        </Text>

        {/* Jours */}
        {entries.map((entry) => (
          <View key={entry.date} style={styles.dayBlock}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayLabel}>{formatDayLabel(entry.date)}</Text>
              <Text style={styles.dayCount}>
                {entry.interventions.length} intervention{entry.interventions.length > 1 ? 's' : ''}
              </Text>
              <View style={styles.dayLine} />
            </View>
            {entry.interventions.map((intv) => (
              <InterventionCard key={intv.id} intv={intv} />
            ))}
          </View>
        ))}

        {/* Footer fixe */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            MemorIA · Journal du chantier · {siteName}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
