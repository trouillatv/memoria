// Sprint 1 — PDF "CR/PV de chantier" (@react-pdf/renderer).
//
// Layout NEUTRE par défaut (Contrabat & co). La mise en page propre à une
// compagnie (ex. signature visuelle BECIB : bandeau de codification, deux
// colonnes point|ACTION, tableau de présence) sera un layout dédié branché via
// le template — cf. mémoire templates-compagnie-moat. Rendu DEPUIS les sections
// (source de vérité), jamais l'inverse.

import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReportDocumentSection } from '@/types/db'

const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  accent: '#4f46e5',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.text,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    lineHeight: 1.45,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 10,
    marginBottom: 18,
  },
  kicker: { fontSize: 8, color: COLORS.faint, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  meta: { fontSize: 9, color: COLORS.muted, marginTop: 4 },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.accent,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paragraph: { marginBottom: 3 },
  bulletRow: { flexDirection: 'row', marginBottom: 2 },
  bulletDot: { width: 10, color: COLORS.muted },
  bulletText: { flex: 1 },
  empty: { color: COLORS.faint, fontStyle: 'italic' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
    fontSize: 8,
    color: COLORS.faint,
  },
})

export interface CrChantierPdfProps {
  title: string
  siteName: string | null
  clientName: string | null
  dateLabel: string
  sections: ReportDocumentSection[]
  /** Mise en page : 'neutral' (défaut) ou 'becib' (bandeau MOA / MOE / chantier). */
  layout?: 'neutral' | 'becib'
  /** Libellé MOE pour le bandeau becib (ex. « BECIB »). */
  companyLabel?: string | null
}

function SectionBody({ content }: { content: string }) {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) {
    return <Text style={styles.empty}>—</Text>
  }
  return (
    <View>
      {lines.map((line, i) => {
        if (line.startsWith('- ')) {
          return (
            <View key={i} style={styles.bulletRow} wrap={false}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{line.slice(2)}</Text>
            </View>
          )
        }
        return (
          <Text key={i} style={styles.paragraph}>{line}</Text>
        )
      })}
    </View>
  )
}

export function CrChantierPdf({ title, siteName, clientName, dateLabel, sections, layout = 'neutral', companyLabel }: CrChantierPdfProps) {
  const subtitleParts = [clientName, siteName].filter(Boolean) as string[]
  // Bandeau BECIB : MOA / MOE / chantier / type de document (répété en tête).
  const bandeau = layout === 'becib'
    ? [clientName, companyLabel, siteName].filter(Boolean).join(' / ') + ' / Compte-rendu de réunion de chantier'
    : null
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {bandeau ? (
            <Text style={{ fontSize: 8, color: COLORS.muted, borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 4, marginBottom: 6 }} fixed>
              {bandeau}
            </Text>
          ) : (
            <Text style={styles.kicker}>Compte-rendu de réunion de chantier</Text>
          )}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>
            {subtitleParts.length > 0 ? `${subtitleParts.join(' · ')} — ` : ''}{dateLabel}
          </Text>
        </View>

        {sections.map((s) => (
          <View key={s.key} style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <SectionBody content={s.content} />
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>{title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
