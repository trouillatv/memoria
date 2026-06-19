// Sprint 1 — PDF "CR/PV de chantier" (@react-pdf/renderer).
//
// Layout NEUTRE par défaut (Contrabat & co). La mise en page propre à une
// compagnie (ex. signature visuelle BECIB : bandeau de codification, deux
// colonnes point|ACTION, tableau de présence) sera un layout dédié branché via
// le template — cf. mémoire templates-compagnie-moat. Rendu DEPUIS les sections
// (source de vérité), jamais l'inverse.

import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReportDocumentSection } from '@/types/db'
import { BECIB_LOGO_DATA_URL } from './becib-logo'

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
  // ── Layout BECIB ──────────────────────────────────────────────────────────
  becibTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  becibLogo: { width: 90, height: 'auto', objectFit: 'contain' },
  becibBandeau: { fontSize: 8, color: COLORS.text, flex: 1, marginRight: 8 },
  becibRef: { fontSize: 7.5, color: COLORS.muted, textAlign: 'right', maxWidth: 150 },
  // En-tête de colonnes « POINTS … | ACTION » (becib).
  colHead: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.border, paddingBottom: 2, marginBottom: 3 },
  colHeadText: { flex: 1, fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: COLORS.muted },
  colHeadAction: { width: 80, fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: COLORS.muted, textAlign: 'right' },
  twoColRow: { flexDirection: 'row', marginBottom: 2 },
  twoColText: { flex: 1 },
  twoColAction: { width: 80, textAlign: 'right', color: COLORS.muted, fontSize: 9 },
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
  /** Ligne de codification (« Numéro DNS · Version · Date ») — layout becib. */
  reference?: string | null
}

// Sections rendues en DEUX COLONNES (point | ACTION) dans le layout becib.
const BECIB_TWO_COL_KEYS = new Set(['points_examines', 'decisions', 'actions'])

// Sépare un point « … (RESPONSABLE) » en { text, action } pour la colonne ACTION
// du layout BECIB. Le responsable est un code court entre parenthèses en fin de
// ligne (ex. « … = en cours (ETV) »). Sinon action vide.
function splitAction(text: string): { text: string; action: string | null } {
  const m = text.match(/^(.*?)\s*\(([^()]{1,40})\)\s*$/)
  if (m && /[A-Za-zÀ-ÿ]/.test(m[2])) return { text: m[1].trim(), action: m[2].trim() }
  return { text, action: null }
}

function SectionBody({ content, twoCol = false }: { content: string; twoCol?: boolean }) {
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) {
    return <Text style={styles.empty}>—</Text>
  }
  return (
    <View>
      {lines.map((line, i) => {
        if (line.startsWith('- ')) {
          const body = line.slice(2)
          if (twoCol) {
            const { text, action } = splitAction(body)
            return (
              <View key={i} style={styles.twoColRow} wrap={false}>
                <Text style={styles.twoColText}>• {text}</Text>
                <Text style={styles.twoColAction}>{action ?? ''}</Text>
              </View>
            )
          }
          return (
            <View key={i} style={styles.bulletRow} wrap={false}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{body}</Text>
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

export function CrChantierPdf({ title, siteName, clientName, dateLabel, sections, layout = 'neutral', companyLabel, reference }: CrChantierPdfProps) {
  const subtitleParts = [clientName, siteName].filter(Boolean) as string[]
  const isBecib = layout === 'becib'
  // Bandeau BECIB : MOA / MOE / chantier / type de document (répété en tête).
  const bandeau = isBecib
    ? [clientName, companyLabel, siteName].filter(Boolean).join(' / ') + ' / Compte-rendu de réunion de chantier'
    : null
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {isBecib ? (
            <>
              <View style={styles.becibTop} fixed>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
                <Image src={BECIB_LOGO_DATA_URL} style={styles.becibLogo} />
                <Text style={styles.becibBandeau}>{bandeau}</Text>
                {reference ? <Text style={styles.becibRef}>{reference}</Text> : null}
              </View>
            </>
          ) : (
            <Text style={styles.kicker}>Compte-rendu de réunion de chantier</Text>
          )}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>
            {subtitleParts.length > 0 ? `${subtitleParts.join(' · ')} — ` : ''}{dateLabel}
          </Text>
        </View>

        {sections.map((s) => {
          const twoCol = isBecib && BECIB_TWO_COL_KEYS.has(s.key)
          return (
            <View key={s.key} style={styles.section} wrap={false}>
              <Text style={styles.sectionTitle}>{s.title}</Text>
              {twoCol && (
                <View style={styles.colHead}>
                  <Text style={styles.colHeadText}>POINTS</Text>
                  <Text style={styles.colHeadAction}>ACTION</Text>
                </View>
              )}
              <SectionBody content={s.content} twoCol={twoCol} />
            </View>
          )
        })}

        <View style={styles.footer} fixed>
          <Text>{title}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
