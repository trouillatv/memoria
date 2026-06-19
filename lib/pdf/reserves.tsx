// Export PDF « Points à lever / réserves » (@react-pdf/renderer).
//
// Réserve = mini-dossier : libellé, statut, dates, photos avant/après, actions
// correctives, documents associés. Rendu sobre B2B (cohérent monthly-report /
// proof-dossier). Réutilisable comme HOOK pour le dossier de preuves (on rend
// la même structure de données — pas de module réception spécifique).
// Vocabulaire : « levé » jamais « résolu ».

import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

const COLORS = {
  text: '#0f172a', muted: '#64748b', faint: '#94a3b8', border: '#e2e8f0',
  accent: '#4f46e5', open: '#b45309', lifted: '#059669',
}

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 10, color: COLORS.text, paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, lineHeight: 1.4 },
  header: { borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 10, marginBottom: 16 },
  kicker: { fontSize: 8, color: COLORS.faint, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  meta: { fontSize: 9, color: COLORS.muted, marginTop: 4 },
  card: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 4, padding: 10, marginBottom: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  num: { fontSize: 9, color: COLORS.faint },
  label: { fontSize: 11, fontFamily: 'Helvetica-Bold', flex: 1, marginRight: 8 },
  badge: { fontSize: 8, fontFamily: 'Helvetica-Bold', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  badgeOpen: { color: COLORS.open, backgroundColor: '#fef3c7' },
  badgeLifted: { color: COLORS.lifted, backgroundColor: '#d1fae5' },
  info: { fontSize: 9, color: COLORS.muted, marginTop: 3 },
  sectionLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: COLORS.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 3 },
  photos: { flexDirection: 'row', gap: 10, marginTop: 6 },
  photoBox: { width: 150 },
  photoCaption: { fontSize: 7, color: COLORS.faint, marginBottom: 2 },
  photo: { width: 150, height: 100, objectFit: 'cover', borderRadius: 3, borderWidth: 1, borderColor: COLORS.border },
  bullet: { fontSize: 9, marginBottom: 1 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 6, fontSize: 8, color: COLORS.faint },
})

export interface ReservePdfItem {
  index: number
  label: string
  status: 'open' | 'lifted'
  location: string | null
  issuedBy: string | null
  issuedOn: string | null
  liftedAt: string | null
  liftNote: string | null
  photoBeforeUrl: string | null
  photoAfterUrl: string | null
  actions: { title: string; assignedTo: string | null; status: string; dueDate: string | null }[]
  documents: { filename: string }[]
}

export interface ReservesPdfProps {
  siteName: string
  clientName: string | null
  dateLabel: string
  reserves: ReservePdfItem[]
}

export function ReservesPdf({ siteName, clientName, dateLabel, reserves }: ReservesPdfProps) {
  const open = reserves.filter((r) => r.status === 'open').length
  return (
    <Document title={`Points à lever — ${siteName}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.kicker}>Points à lever / réserves</Text>
          <Text style={styles.title}>{siteName}</Text>
          <Text style={styles.meta}>
            {clientName ? `${clientName} — ` : ''}{dateLabel} · {open} ouvert{open > 1 ? 's' : ''} / {reserves.length} au total
          </Text>
        </View>

        {reserves.map((r) => (
          <View key={r.index} style={styles.card} wrap={false}>
            <View style={styles.rowTop}>
              <Text style={styles.label}>
                <Text style={styles.num}>N°{r.index} · </Text>{r.label}
              </Text>
              <Text style={[styles.badge, r.status === 'lifted' ? styles.badgeLifted : styles.badgeOpen]}>
                {r.status === 'lifted' ? 'LEVÉ' : 'OUVERT'}
              </Text>
            </View>
            <Text style={styles.info}>
              {[r.location, r.issuedBy && `émis par ${r.issuedBy}`, r.issuedOn && `émis le ${r.issuedOn}`, r.liftedAt && `levé le ${r.liftedAt}`]
                .filter(Boolean).join(' · ') || '—'}
            </Text>
            {r.liftNote ? <Text style={styles.info}>Levée : {r.liftNote}</Text> : null}

            {(r.photoBeforeUrl || r.photoAfterUrl) && (
              <View style={styles.photos}>
                {r.photoBeforeUrl && (
                  <View style={styles.photoBox}>
                    <Text style={styles.photoCaption}>Constat (avant)</Text>
                    {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image, pas une balise HTML */}
                    <Image src={r.photoBeforeUrl} style={styles.photo} />
                  </View>
                )}
                {r.photoAfterUrl && (
                  <View style={styles.photoBox}>
                    <Text style={styles.photoCaption}>Preuve (après)</Text>
                    {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image, pas une balise HTML */}
                    <Image src={r.photoAfterUrl} style={styles.photo} />
                  </View>
                )}
              </View>
            )}

            {r.actions.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Actions correctives</Text>
                {r.actions.map((a, i) => (
                  <Text key={i} style={styles.bullet}>
                    • {a.title}{a.assignedTo ? ` — ${a.assignedTo}` : ''}{a.dueDate ? ` (échéance ${a.dueDate})` : ''} = {a.status}
                  </Text>
                ))}
              </>
            )}

            {r.documents.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Documents associés</Text>
                {r.documents.map((d, i) => (
                  <Text key={i} style={styles.bullet}>• {d.filename}</Text>
                ))}
              </>
            )}
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>Points à lever — {siteName}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
