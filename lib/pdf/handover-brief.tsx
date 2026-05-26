// Générateur PDF "Brief de passage de témoin" (@react-pdf/renderer).
//
// Polish /h/[token] (Vincent 2026-05-27) — version imprimable/archivable du
// brief public. Le brief = moment magique ([[brief-moment-magique]]) : on doit
// pouvoir l'imprimer pour la relève qui n'a pas de téléphone sous la main, ou
// l'archiver.
//
// Doctrine :
//   - Snapshot brut : on affiche le payload tel quel, aucune nuance inventée.
//   - Sujet = lieu / mémoire. JAMAIS d'évaluation de personne (footer explicite).
//   - QR en footer fixe → pointe vers /h/<token> (la vue publique). Passé en
//     data URL pour éviter une fetch réseau pendant le rendu.
//   - Sobriété B2B, Helvetica, A4 portrait. Pattern aligné sur proof-dossier.

import React from 'react'
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import type { HandoverPayload } from '@/types/db'

const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  surface: '#f8fafc',
  accent: '#4f46e5',
  warn: '#b45309',
  rose: '#9f1239',
  roseSurface: '#fff1f2',
}

const KIND_LABEL: Record<string, string> = {
  member_change: 'Changement d’équipe',
  team_takes_site: 'Prise de site',
  manual: 'Brief',
}

const CATEGORY_LABEL: Record<string, string> = {
  materiel_casse: 'Matériel cassé',
  produit_manquant: 'Produit manquant',
  acces_bloque: 'Accès bloqué',
  retard: 'Retard',
  autre: 'Autre',
}

const DOC_TYPE_LABEL: Record<string, string> = {
  contrat: 'Contrat', avenant: 'Avenant', procedure: 'Procédure',
  protocole: 'Protocole', plan_acces: 'Plan d’accès', securite: 'Sécurité',
  ao: 'AO', memoire_technique: 'Mémoire technique', reference: 'Référence',
  facture: 'Facture', preuve: 'Preuve', autre: 'Document',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica', fontSize: 10, color: COLORS.text,
    paddingTop: 36, paddingBottom: 64, paddingHorizontal: 36, lineHeight: 1.4,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 8, marginBottom: 14,
  },
  brand: { fontSize: 12, fontWeight: 700, color: COLORS.accent, letterSpacing: 1 },
  brandSubtitle: { fontSize: 8, color: COLORS.muted, marginTop: 2 },
  headerRight: { fontSize: 8, color: COLORS.muted, textAlign: 'right' },
  kindBadge: {
    alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderWidth: 1,
    borderColor: COLORS.border, borderRadius: 3, paddingVertical: 2, paddingHorizontal: 6,
    fontSize: 8, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
  },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 10 },

  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 8, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  context: { fontSize: 10 },
  snapshotNote: { fontSize: 8, color: COLORS.faint, marginTop: 3, fontStyle: 'italic' },

  notes: {
    backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a',
    borderRadius: 4, padding: 8, marginBottom: 12,
  },
  notesTitle: { fontSize: 8, fontWeight: 700, color: COLORS.warn, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.6 },

  site: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 4,
    padding: 10, marginBottom: 10,
  },
  siteHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 6, marginBottom: 6,
  },
  siteName: { fontSize: 12, fontWeight: 700 },
  siteMeta: { fontSize: 8, color: COLORS.muted, marginTop: 2 },
  siteStats: { fontSize: 8, color: COLORS.muted, textAlign: 'right' },

  block: { marginTop: 6 },
  blockLabel: { fontSize: 8, fontWeight: 700, color: COLORS.text, marginBottom: 3 },
  aSavoirItem: {
    fontSize: 9, backgroundColor: COLORS.roseSurface, borderWidth: 1, borderColor: '#fecdd3',
    borderRadius: 3, paddingVertical: 3, paddingHorizontal: 6, marginBottom: 3,
  },
  anomalyItem: {
    fontSize: 9, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa',
    borderRadius: 3, paddingVertical: 3, paddingHorizontal: 6, marginBottom: 3,
  },
  docItem: { fontSize: 9, color: COLORS.muted, marginBottom: 2 },
  teamItem: { fontSize: 9, color: COLORS.muted },
  emptyNote: { fontSize: 8, color: COLORS.faint, fontStyle: 'italic' },

  footer: {
    position: 'absolute', bottom: 24, left: 36, right: 36,
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8,
  },
  footerQr: { width: 40, height: 40, marginRight: 8 },
  footerText: { flexDirection: 'column', flex: 1 },
  footerLabel: { fontSize: 7, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  footerUrl: { fontSize: 8, color: COLORS.accent, marginTop: 1 },
  footerWatermark: { fontSize: 7, color: COLORS.faint, marginTop: 2 },
})

export function HandoverBriefPdf({
  title,
  kind,
  payload,
  qrDataUrl,
  shareUrl,
}: {
  title: string
  kind: string
  payload: HandoverPayload
  qrDataUrl?: string | null
  shareUrl: string
}) {
  const sites = payload.sites ?? []
  return (
    <Document title={title} author="MemorIA">
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>MEMORIA</Text>
            <Text style={styles.brandSubtitle}>Mémoire opérationnelle augmentée</Text>
          </View>
          <Text style={styles.headerRight}>
            Brief de passage de témoin{'\n'}
            Généré le {fmtDate(payload.generatedAt)}
          </Text>
        </View>

        <Text style={styles.kindBadge}>{KIND_LABEL[kind] ?? kind}</Text>
        <Text style={styles.title}>{title}</Text>

        {/* Contexte */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contexte</Text>
          <Text style={styles.context}>{payload.context}</Text>
          <Text style={styles.snapshotNote}>
            Snapshot du {fmtDate(payload.generatedAt)} — reflète ce qui était vrai à ce moment précis.
          </Text>
        </View>

        {/* Notes manager */}
        {payload.manualNotes ? (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Notes du manager</Text>
            <Text style={{ fontSize: 9 }}>{payload.manualNotes}</Text>
          </View>
        ) : null}

        {/* Sites */}
        <Text style={styles.sectionTitle}>
          {sites.length === 0 ? 'Sites concernés' : sites.length === 1 ? 'Site concerné' : `${sites.length} sites concernés`}
        </Text>
        {sites.length === 0 ? (
          <Text style={styles.emptyNote}>
            Aucun site concerné — le sujet du brief n’a pas de site documenté sur la période.
          </Text>
        ) : (
          sites.map((s) => (
            <View key={s.site_id} style={styles.site} wrap={false}>
              <View style={styles.siteHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.siteName}>{s.site_name}</Text>
                  <Text style={styles.siteMeta}>
                    {[s.client_name, s.contract_name].filter(Boolean).join(' · ') || '—'}
                  </Text>
                </View>
                <Text style={styles.siteStats}>
                  {s.interventionsCount} intervention{s.interventionsCount > 1 ? 's' : ''}{'\n'}
                  Dern. {fmtDate(s.lastInterventionDate)}
                </Text>
              </View>

              {s.aSavoir.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>À savoir</Text>
                  {s.aSavoir.map((a) => (
                    <Text key={a.id} style={styles.aSavoirItem}>{a.description ?? a.title}</Text>
                  ))}
                </View>
              )}

              {s.recentAnomalies.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Anomalies actives (90 derniers jours)</Text>
                  {s.recentAnomalies.map((a) => (
                    <Text key={a.id} style={styles.anomalyItem}>
                      {CATEGORY_LABEL[a.category] ?? a.category}
                      {a.description ? ` — ${a.description}` : ''}
                      {`  (${fmtDate(a.occurredAt)})`}
                    </Text>
                  ))}
                </View>
              )}

              {s.documents.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Documents rattachés</Text>
                  {s.documents.map((d) => (
                    <Text key={d.id} style={styles.docItem}>
                      • {d.title}{d.documentType ? ` · ${DOC_TYPE_LABEL[d.documentType] ?? d.documentType}` : ''}
                    </Text>
                  ))}
                </View>
              )}

              {s.neighborTeams.length > 0 && (
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Équipes voisines (back-up potentiel)</Text>
                  <Text style={styles.teamItem}>
                    {s.neighborTeams.map((t) => t.team_name).join(' · ')}
                  </Text>
                </View>
              )}

              {s.aSavoir.length === 0 && s.recentAnomalies.length === 0 &&
                s.documents.length === 0 && s.neighborTeams.length === 0 && (
                  <Text style={styles.emptyNote}>
                    Aucune mémoire spécifique sur ce site — à nourrir au fil des interventions.
                  </Text>
                )}
            </View>
          ))
        )}

        {/* Footer fixe avec QR */}
        <View style={styles.footer} fixed>
          {qrDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={qrDataUrl} style={styles.footerQr} />
          ) : null}
          <View style={styles.footerText}>
            <Text style={styles.footerLabel}>Brief consultable en ligne</Text>
            <Text style={styles.footerUrl}>{shareUrl}</Text>
            <Text style={styles.footerWatermark}>
              MemorIA — documente le site et la mémoire utile. Aucune évaluation de personne.
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  )
}
