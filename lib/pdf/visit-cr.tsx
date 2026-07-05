// PDF « Compte-rendu de visite » (@react-pdf/renderer).
//
// Sortie PARTAGEABLE du Débrief : rendu déterministe du même `VisitCrDoc` que le
// markdown (lib/db/visits.ts — source de vérité unique). Layout neutre, aligné sur
// cr-chantier.tsx. Aucun fait inventé : ce qui n'a pas été relevé apparaît en
// « — ». Généré à la volée, jamais stocké.

import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { VisitCrDoc } from '@/lib/db/visits'

const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  accent: '#047857', // emerald-700 — couleur des visites terrain
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
  header: { borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 10, marginBottom: 18 },
  kicker: { fontSize: 8, color: COLORS.faint, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  meta: { fontSize: 9, color: COLORS.muted, marginTop: 4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  metaItem: { fontSize: 9, color: COLORS.muted, marginRight: 12 },
  metaStrong: { fontFamily: 'Helvetica-Bold', color: COLORS.text },
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
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photo: { width: 158, height: 118, objectFit: 'cover', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 3 },
  mediaNote: { fontSize: 9, color: COLORS.muted, marginTop: 4 },
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

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <Text style={styles.empty}>{empty}</Text>
  return (
    <View>
      {items.map((line, i) => (
        <View key={i} style={styles.bulletRow} wrap={false}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{line}</Text>
        </View>
      ))}
    </View>
  )
}

export function VisitCrPdf({ doc, exportDate }: { doc: VisitCrDoc; exportDate: string }) {
  const title = `Compte-rendu de visite — ${doc.siteName}`
  // Réserves/actions = objets bureau (site_reserve/actions) + tags terrain (écran 2).
  const reserveLines = [
    ...doc.reserves.map((r) => `${r.label}${r.location ? ` (${r.location})` : ''}`),
    ...doc.points.reserve,
  ]
  const actionLines = [
    ...doc.actions.map((a) => `${a.corps_etat ? `(${a.corps_etat}) ` : ''}${a.title}`),
    ...doc.points.action,
  ]

  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <Text style={styles.kicker}>Compte-rendu de visite de chantier</Text>
          <Text style={styles.title}>{doc.siteName}</Text>
          <View style={styles.metaRow}>
            {doc.clientName ? <Text style={styles.metaItem}>{doc.clientName}</Text> : null}
            <Text style={styles.metaItem}>
              <Text style={styles.metaStrong}>Date : </Text>{doc.dateLabel}
            </Text>
            <Text style={styles.metaItem}>
              <Text style={styles.metaStrong}>Type : </Text>{doc.typeLabel}
            </Text>
            {doc.durationLabel ? (
              <Text style={styles.metaItem}>
                <Text style={styles.metaStrong}>Durée : </Text>{doc.durationLabel}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Objet de la visite</Text>
          <Text style={doc.objective ? styles.paragraph : styles.empty}>
            {doc.objective ?? 'Non précisé.'}
          </Text>
          {doc.subjectName ? <Text style={styles.paragraph}>Sujet : {doc.subjectName}</Text> : null}
        </View>

        {doc.summary && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>Résumé</Text>
            <Text style={styles.paragraph}>{doc.summary}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Constats</Text>
          <Bullets items={doc.constats} empty="Aucune note saisie pendant la visite." />
        </View>

        {reserveLines.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Réserves</Text>
            <Bullets items={reserveLines} empty="—" />
          </View>
        )}

        {doc.points.surveiller.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Points à surveiller</Text>
            <Bullets items={doc.points.surveiller} empty="—" />
          </View>
        )}

        {actionLines.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Actions à réaliser</Text>
            <Bullets items={actionLines} empty="—" />
          </View>
        )}

        {doc.photos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photos ({doc.photos.length})</Text>
            <View style={styles.photoGrid}>
              {doc.photos.map((url, i) => (
                // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image
                <Image key={i} src={url} style={styles.photo} />
              ))}
            </View>
          </View>
        )}

        {(doc.videoCount > 0 || doc.vocalCount > 0) && (
          <Text style={styles.mediaNote}>
            Autres médias :{' '}
            {[
              doc.videoCount > 0 ? `${doc.videoCount} vidéo${doc.videoCount > 1 ? 's' : ''}` : null,
              doc.vocalCount > 0 ? `${doc.vocalCount} mémo${doc.vocalCount > 1 ? 's' : ''} vocal${doc.vocalCount > 1 ? 'aux' : ''}` : null,
            ].filter(Boolean).join(' · ')}{' '}
            — consultables dans la visite.
          </Text>
        )}

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Bilan</Text>
          <Text style={styles.paragraph}>
            <Text style={styles.metaStrong}>Résultat : </Text>
            {doc.outcomeLabel ?? 'non précisé'}
          </Text>
          <Text style={styles.paragraph}>
            <Text style={styles.metaStrong}>Suivi : </Text>
            {doc.resolutionLabel ?? 'non précisé'}
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>Compte-rendu généré par MemorIA · {exportDate}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
