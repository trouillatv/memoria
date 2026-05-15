// Sprint 3 — UX-8 Mode litige express : PDF agrégé "Préparation de défense".
//
// Doctrine V5 — Pilier 1 + Verrou V1 + Verrou V4 (strict) :
//   - Wording « Préparation de défense », jamais « Attaque ».
//   - Pas de wording marketing ni évaluatif.
//   - Sobriété B2B : pas de couleurs flashy, pas d'emoji.
//   - Footer fixe avec QR vérification + Page X / Y.
//
// Diffère du `proof-dossier.tsx` (Phase 5 / Slice B.3) : ce PDF AGRÈGE
// plusieurs interventions sur une période (site × période), pas une seule
// intervention. Le pattern de styles est volontairement aligné pour cohérence
// visuelle (mêmes couleurs sobres, mêmes marges, même footer).

import React from 'react'
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import type { ProofIntervention } from '@/lib/db/proofs'

// ----------------------------------------------------------------------------
// Constantes
// ----------------------------------------------------------------------------

export const MAX_INTERVENTIONS_LISTED = 80

const COLORS = {
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  surface: '#f8fafc',
  accent: '#4f46e5',
  warn: '#b45309',
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

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

  // Header (haut de page 1)
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
  brand: {
    fontSize: 12,
    fontWeight: 700,
    color: COLORS.accent,
    letterSpacing: 1,
  },
  brandSubtitle: { fontSize: 9, color: COLORS.muted, marginTop: 2 },
  headerRight: { fontSize: 9, color: COLORS.muted, textAlign: 'right' },

  // Titre + sous-titre
  titleSection: { marginBottom: 14 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: COLORS.muted },

  // Bande méta — récap période / site
  metaBand: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 10,
    marginBottom: 14,
  },
  stat: { width: '25%', paddingHorizontal: 4 },
  statLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statValue: { fontSize: 11, fontWeight: 700, marginTop: 2 },

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

  // Liste interventions
  interventionItem: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: 8,
    marginBottom: 6,
  },
  itemTitle: { fontSize: 10, fontWeight: 700 },
  itemMeta: { fontSize: 8, color: COLORS.muted, marginTop: 1 },
  itemCounters: { fontSize: 9, color: COLORS.muted, marginTop: 3 },

  // Note d'overflow
  overflowNote: {
    fontSize: 9,
    color: COLORS.warn,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    padding: 6,
    borderRadius: 4,
    marginTop: 6,
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
  footerLabel: {
    fontSize: 7,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  footerUrl: { fontSize: 8, color: COLORS.accent, marginTop: 1 },
  footerWatermark: { fontSize: 7, color: COLORS.faint, marginTop: 2 },
  pageNumber: { fontSize: 8, color: COLORS.muted },
})

// ----------------------------------------------------------------------------
// Formatters
// ----------------------------------------------------------------------------

function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

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

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

// ----------------------------------------------------------------------------
// Composant principal
// ----------------------------------------------------------------------------

export interface LitigeDossierProps {
  /** Nom du site concerné (pour le titre). */
  siteName: string
  /** Borne basse de la période (yyyy-mm-dd). */
  dateFrom: string
  /** Borne haute de la période (yyyy-mm-dd). */
  dateTo: string
  /** Interventions agrégées sur la période (antichrono, déjà filtrées). */
  interventions: ProofIntervention[]
  /** Compteurs agrégés (mis en bandeau). */
  counts: {
    interventions: number
    photos: number
    anomalies: number
    anomaliesResolved: number
    validations: number
  }
  /** Horodatage de génération (ISO). */
  generatedAt: string
  /** QR code data URL (PNG base64) pointant vers la page de vérif. Optionnel. */
  qrDataUrl?: string | null
  /** URL publique de partage (lisible en cas de QR illisible). Optionnel. */
  shareUrl?: string | null
  /** Expiration du token (ISO) pour mention header. Optionnel. */
  expiresAt?: string | null
  /** Nom du tenant (héros visible, doctrine Pilier 6). */
  tenantName?: string
}

export function LitigeDossierPdf({
  siteName,
  dateFrom,
  dateTo,
  interventions,
  counts,
  generatedAt,
  qrDataUrl,
  shareUrl,
  expiresAt,
  tenantName,
}: LitigeDossierProps) {
  const interventionsToList = interventions.slice(0, MAX_INTERVENTIONS_LISTED)
  const overflow = Math.max(0, interventions.length - MAX_INTERVENTIONS_LISTED)

  const periodLabel = `Du ${fmtDateLong(dateFrom)} au ${fmtDateLong(dateTo)}`
  const anomaliesLabel =
    counts.anomalies === 0
      ? 'Aucune'
      : `${counts.anomalies} (${counts.anomaliesResolved} clôturée${
          counts.anomaliesResolved > 1 ? 's' : ''
        })`

  return (
    <Document
      title={`Préparation de défense — ${siteName}`}
      author="MemorIA"
      subject="Préparation de défense — dossier site × période"
      creator="MemorIA — Préparation de défense"
    >
      <Page size="A4" style={styles.page}>
        {/* Header — Pilier 6 : prestataire en hero, MemorIA en footer. */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.brand}>
              {((tenantName ?? '').trim() || 'Votre entreprise').toUpperCase()}
            </Text>
            <Text style={styles.brandSubtitle}>Préparation de défense</Text>
          </View>
          <View style={styles.headerRight}>
            <Text>Généré le {fmtDateTime(generatedAt)}</Text>
            {expiresAt && (
              <Text>Lien valable jusqu&apos;au {fmtDateTime(expiresAt)}</Text>
            )}
          </View>
        </View>

        {/* Titre + sous-titre */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Préparation de défense</Text>
          <Text style={styles.subtitle}>{siteName}</Text>
          <Text style={[styles.subtitle, { marginTop: 2 }]}>{periodLabel}</Text>
        </View>

        {/* Bande compteurs agrégés (factuels, passifs) */}
        <View style={styles.metaBand}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Interventions</Text>
            <Text style={styles.statValue}>
              {counts.interventions.toLocaleString('fr-FR')}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Photos</Text>
            <Text style={styles.statValue}>
              {counts.photos.toLocaleString('fr-FR')}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Validations</Text>
            <Text style={styles.statValue}>
              {counts.validations.toLocaleString('fr-FR')}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Anomalies</Text>
            <Text style={styles.statValue}>{anomaliesLabel}</Text>
          </View>
        </View>

        {/* Liste interventions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Interventions documentées ({counts.interventions})
          </Text>
          {interventionsToList.length === 0 ? (
            <Text style={styles.sectionEmpty}>
              Aucune intervention documentée sur la période.
            </Text>
          ) : (
            <>
              {interventionsToList.map((it) => (
                <View key={it.id} style={styles.interventionItem} wrap={false}>
                  <Text style={styles.itemTitle}>{it.title}</Text>
                  <Text style={styles.itemMeta}>
                    {fmtDateShort(it.executed_at ?? it.scheduled_at)}
                    {it.contract_name ? ` · ${it.contract_name}` : ''}
                  </Text>
                  <Text style={styles.itemCounters}>
                    {it.photosCount} photo{it.photosCount > 1 ? 's' : ''} ·{' '}
                    {it.validationsCount} validation
                    {it.validationsCount > 1 ? 's' : ''}
                    {it.anomaliesCount > 0
                      ? ` · ${it.anomaliesCount} anomalie${
                          it.anomaliesCount > 1 ? 's' : ''
                        } (${it.anomaliesResolvedCount} clôturée${
                          it.anomaliesResolvedCount > 1 ? 's' : ''
                        })`
                      : ''}
                  </Text>
                </View>
              ))}
              {overflow > 0 && (
                <Text style={styles.overflowNote}>
                  {overflow} intervention{overflow > 1 ? 's' : ''}{' '}
                  additionnelle{overflow > 1 ? 's' : ''} disponible
                  {overflow > 1 ? 's' : ''} via le lien public de vérification.
                </Text>
              )}
            </>
          )}
        </View>

        {/* Footer fixe — QR + URL vérif + watermark + page X/Y */}
        <View style={styles.footer} fixed>
          {qrDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={qrDataUrl} style={styles.footerQr} />
          ) : null}
          <View style={styles.footerText}>
            <Text style={styles.footerLabel}>Vérification authentique</Text>
            {shareUrl ? (
              <Text style={styles.footerUrl}>{shareUrl}</Text>
            ) : (
              <Text style={styles.footerUrl}>Lien public non encore généré</Text>
            )}
            <Text style={styles.footerWatermark}>
              Document préparé via MemorIA · Vérifiable via QR · Généré le{' '}
              {fmtDateTime(generatedAt)}
            </Text>
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} / ${totalPages}`
            }
            fixed
          />
        </View>
      </Page>
    </Document>
  )
}
