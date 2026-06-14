// Slice B.3 — Générateur PDF "Dossier de preuves" (@react-pdf/renderer).
//
// Doctrine impérative :
//   - Sobriété B2B. Pas de couleurs flashy, pas d'icônes "marketing".
//   - Anonymisation par défaut : équipe terrain en compteur ("3 personnes"),
//     validations en rôle ("Équipe superviseur"). Identités jamais affichées
//     sauf override admin (includeIdentities=true).
//   - Watermark sobre en footer : "Preuves MemorIA — vérifiables via QR code".
//     Pas de gros logo.
//   - QR code en footer fixe sur chaque page : pointe vers /p/<token> (la vérif
//     publique). Le QR est passé en data URL pour éviter une nouvelle fetch.
//   - Plafond photos : MAX_PHOTOS_IN_PDF, au-delà on affiche une note "X photos
//     additionnelles disponibles via le lien public". Performance + lisibilité.
//
// Format : A4 portrait, marges raisonnables. Police par défaut de @react-pdf
// (Helvetica) — pas besoin d'embed custom pour le MVP.

import React from 'react'
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import type { ProofDetail } from '@/lib/db/proofs'

// ----------------------------------------------------------------------------
// Constantes
// ----------------------------------------------------------------------------

export const MAX_PHOTOS_IN_PDF = 50

// Palette sobre. Slate-ish + une touche d'indigo pour les accents.
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
    paddingBottom: 64, // pour laisser place au footer fixe
    paddingHorizontal: 36,
    lineHeight: 1.4,
  },

  // Header (top of first page only)
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

  // Title section
  titleSection: { marginBottom: 14 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 10, color: COLORS.muted },

  // Status badge
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    borderWidth: 1,
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statusValidated: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    color: '#065f46',
  },
  statusCompleted: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    color: '#3730a3',
  },
  statusInProgress: {
    backgroundColor: '#f0f9ff',
    borderColor: '#bae6fd',
    color: '#075985',
  },
  statusPlanned: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    color: '#334155',
  },
  statusSkipped: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    color: '#92400e',
  },

  // Meta band — 4 stats sobres
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
  statLabel: { fontSize: 8, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: 11, fontWeight: 700, marginTop: 2 },

  // Skipped banner
  skippedBanner: {
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    color: '#92400e',
    padding: 8,
    borderRadius: 4,
    marginBottom: 12,
    fontSize: 9,
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

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  photoItem: {
    width: '50%',
    padding: 4,
  },
  photoFrame: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  photoImage: { width: '100%', height: 180, objectFit: 'cover' },
  photoCaption: { fontSize: 9, padding: 6, paddingBottom: 2 },
  photoMeta: { fontSize: 8, color: COLORS.muted, paddingHorizontal: 6, paddingBottom: 6 },
  photoExcess: {
    fontSize: 9,
    color: COLORS.warn,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    padding: 6,
    borderRadius: 4,
    marginTop: 6,
  },

  // Checklist
  checklistItem: { flexDirection: 'row', gap: 6, marginBottom: 3 },
  checklistMark: { width: 12 },
  checklistDone: { color: '#059669' },
  checklistTodo: { color: COLORS.muted },

  // Validations / Anomalies
  listItem: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: 8,
    marginBottom: 6,
  },
  itemTitle: { fontSize: 10, fontWeight: 700 },
  itemMeta: { fontSize: 8, color: COLORS.muted, marginTop: 1 },
  itemBody: { fontSize: 9, marginTop: 3 },

  anomalyResolved: { borderLeftColor: '#a7f3d0' },
  anomalyOpen: { borderLeftColor: '#fde68a' },

  // Notes
  notesBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 8,
    fontSize: 9,
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
// Helpers de formatage
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

function fmtDuration(min: number | null | undefined): string {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planifiée',
  in_progress: 'En cours',
  completed: 'Exécutée',
  validated: 'Validée',
  skipped: 'Sautée',
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Équipe superviseur',
  manager: 'Équipe superviseur',
  chef_equipe: 'Équipe terrain',
}

const ANOMALY_CATEGORY_LABELS: Record<string, string> = {
  eau_coupee: 'Eau coupée',
  electricite_coupee: 'Électricité coupée',
  acces_bloque: 'Accès impossible',
  materiel_casse: 'Matériel manquant',
  materiel_manquant: 'Matériel manquant',
  zone_non_prete: 'Zone non prête',
  zone_inaccessible: 'Zone inaccessible',
  danger_securite: 'Danger / sécurité',
  livraison_probleme: 'Livraison problème',
  produit_manquant: 'Produit manquant',
  autre: 'Autre',
}

function statusStyle(status: string, skipped: boolean) {
  const effective = skipped ? 'skipped' : status
  switch (effective) {
    case 'validated':
      return styles.statusValidated
    case 'completed':
      return styles.statusCompleted
    case 'in_progress':
      return styles.statusInProgress
    case 'skipped':
      return styles.statusSkipped
    default:
      return styles.statusPlanned
  }
}

// ----------------------------------------------------------------------------
// Composant principal
// ----------------------------------------------------------------------------

export interface DossierProps {
  proof: ProofDetail
  /** QR code en data URL (PNG base64). Si null/undefined, on n'affiche pas le QR. */
  qrDataUrl?: string | null
  /** URL de partage publique (rendue dans le footer + lisible au cas où le QR ne scanne pas). */
  shareUrl?: string | null
  /** Horodatage de génération du dossier (ISO). */
  generatedAt: string
  /** Override admin : true = identités visibles. Default false. */
  includeIdentities: boolean
  /** Date d'expiration du token (ISO), affichée dans le header. */
  expiresAt?: string | null
  /** Nom du tenant si dispo (affiché dans le header, à la place d'un nom en dur). */
  tenantName?: string
}

export function ProofDossierPdf({
  proof,
  qrDataUrl,
  shareUrl,
  generatedAt,
  includeIdentities,
  expiresAt,
  tenantName,
}: DossierProps) {
  const dateSource = proof.executed_at ?? proof.scheduled_at
  const dateLabel = proof.executed_at
    ? `Exécutée le ${fmtDateLong(dateSource)}`
    : `Planifiée le ${fmtDateLong(dateSource)}`

  // Anonymisation : par défaut on parle d'équipes ("personnes"), pas d'identités.
  // Si includeIdentities=true, l'appelant nous filera plus tard des données nominatives,
  // mais le ProofDetail actuel ne contient déjà PLUS de noms — c'est doctrinal. La case
  // includeIdentities reste donc essentiellement un drapeau d'override visible dans
  // l'en-tête + l'audit, mais aucune fuite d'identité n'est techniquement possible ici.
  const teamLabel =
    proof.team_size > 0
      ? `${proof.team_size} personne${proof.team_size > 1 ? 's' : ''}`
      : '—'

  const resolvedAnomalies = proof.anomalies.filter((a) => a.resolved_at).length
  const anomaliesLabel =
    proof.anomalies.length === 0
      ? 'Aucune'
      : `${proof.anomalies.length} (${resolvedAnomalies} résolue${resolvedAnomalies > 1 ? 's' : ''})`

  const photosToRender = proof.photos.slice(0, MAX_PHOTOS_IN_PDF)
  const photosOverflow = Math.max(0, proof.photos.length - MAX_PHOTOS_IN_PDF)

  return (
    <Document
      title={`Dossier de preuves — ${proof.mission_name}`}
      author="MemorIA"
      subject="Dossier de preuves d'intervention"
      creator="MemorIA — Preuves vérifiables"
    >
      <Page size="A4" style={styles.page}>
        {/* Header — Slice S1 Pilier 6 : prestataire en hero, MemorIA en footer.
            Si tenantName absent : fallback "Votre entreprise" (jamais un nom de marque en dur). */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.brand}>
              {((tenantName ?? '').trim() || 'Votre entreprise').toUpperCase()}
            </Text>
            <Text style={styles.brandSubtitle}>Dossier de preuves</Text>
          </View>
          <View style={styles.headerRight}>
            <Text>Généré le {fmtDateTime(generatedAt)}</Text>
            {expiresAt && <Text>Lien valable jusqu&apos;au {fmtDateTime(expiresAt)}</Text>}
            {includeIdentities && (
              <Text style={{ color: COLORS.warn, marginTop: 2 }}>
                Version juridique — identités incluses
              </Text>
            )}
          </View>
        </View>

        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>{proof.mission_name}</Text>
          <Text style={styles.subtitle}>
            {proof.site_name}
            {proof.contract_name ? ` · ${proof.contract_name}` : ''}
            {proof.client_name ? ` · ${proof.client_name}` : ''}
          </Text>
          <Text style={[styles.subtitle, { marginTop: 2 }]}>{dateLabel}</Text>
          <View style={styles.statusRow}>
            <Text style={[styles.statusBadge, statusStyle(proof.status, !!proof.skipped_at)]}>
              {STATUS_LABELS[proof.skipped_at ? 'skipped' : proof.status] ?? proof.status}
            </Text>
          </View>
        </View>

        {proof.skipped_at && (
          <View style={styles.skippedBanner}>
            <Text>
              Intervention non effectuée ce jour-là. Raison&nbsp;:{' '}
              {proof.skipped_reason ?? 'non précisée'}
            </Text>
          </View>
        )}

        {/* Meta band */}
        <View style={styles.metaBand}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Durée</Text>
            <Text style={styles.statValue}>{fmtDuration(proof.duration_minutes)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Équipe terrain</Text>
            <Text style={styles.statValue}>{teamLabel}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Validations</Text>
            <Text style={styles.statValue}>{String(proof.validations.length)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Anomalies</Text>
            <Text style={styles.statValue}>{anomaliesLabel}</Text>
          </View>
        </View>

        {/* Photos */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos prises ({proof.photos.length})</Text>
          {photosToRender.length === 0 ? (
            <Text style={styles.sectionEmpty}>Aucune photo capturée pour cette intervention.</Text>
          ) : (
            <>
              <View style={styles.photoGrid}>
                {photosToRender.map((photo) => (
                  <View key={photo.id} style={styles.photoItem} wrap={false}>
                    <View style={styles.photoFrame}>
                      {photo.url ? (
                        // eslint-disable-next-line jsx-a11y/alt-text
                        <Image src={photo.url} style={styles.photoImage} />
                      ) : (
                        <View style={[styles.photoImage, { alignItems: 'center', justifyContent: 'center' }]}>
                          <Text style={styles.sectionEmpty}>(image indisponible)</Text>
                        </View>
                      )}
                      {photo.caption ? (
                        <Text style={styles.photoCaption}>{photo.caption}</Text>
                      ) : null}
                      <Text style={styles.photoMeta}>
                        Capturée le {fmtDateTime(photo.taken_at)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
              {photosOverflow > 0 && (
                <Text style={styles.photoExcess}>
                  {photosOverflow} photo{photosOverflow > 1 ? 's' : ''} additionnelle
                  {photosOverflow > 1 ? 's' : ''} disponible
                  {photosOverflow > 1 ? 's' : ''} via le lien public de vérification.
                </Text>
              )}
            </>
          )}
        </View>

        {/* Checklist */}
        {proof.checklist.length > 0 && (
          <View style={styles.section} break>
            <Text style={styles.sectionTitle}>Étapes réalisées</Text>
            {proof.checklist.map((item) => (
              <View key={item.id} style={styles.checklistItem} wrap={false}>
                <Text
                  style={[
                    styles.checklistMark,
                    item.completed ? styles.checklistDone : styles.checklistTodo,
                  ]}
                >
                  {item.completed ? '✓' : '•'}
                </Text>
                <Text style={{ flex: 1 }}>
                  {item.label}
                  {item.completed_at ? ` — ${fmtDateTime(item.completed_at)}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Validations */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Validations</Text>
          {proof.validations.length === 0 ? (
            <Text style={styles.sectionEmpty}>Aucune validation enregistrée.</Text>
          ) : (
            proof.validations.map((v) => (
              <View key={v.id} style={styles.listItem} wrap={false}>
                <Text style={styles.itemTitle}>
                  {ROLE_LABELS[v.validator_role] ?? 'Équipe superviseur'}
                </Text>
                <Text style={styles.itemMeta}>Validée le {fmtDateTime(v.validated_at)}</Text>
                {v.comment && <Text style={styles.itemBody}>{v.comment}</Text>}
              </View>
            ))
          )}
        </View>

        {/* Anomalies */}
        {proof.anomalies.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Anomalies signalées</Text>
            {proof.anomalies.map((a) => (
              <View
                key={a.id}
                style={[
                  styles.listItem,
                  a.resolved_at ? styles.anomalyResolved : styles.anomalyOpen,
                ]}
                wrap={false}
              >
                <Text style={styles.itemTitle}>
                  {ANOMALY_CATEGORY_LABELS[a.category] ?? a.category}
                  {a.resolved_at ? ' — résolue' : ' — en cours'}
                </Text>
                <Text style={styles.itemMeta}>Signalée le {fmtDateTime(a.reported_at)}</Text>
                {a.description && <Text style={styles.itemBody}>{a.description}</Text>}
                {a.resolved_at && a.resolution_note && (
                  <Text style={styles.itemBody}>
                    Résolution&nbsp;: {a.resolution_note} ({fmtDateTime(a.resolved_at)})
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Notes */}
        {proof.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesBox}>{proof.notes}</Text>
          </View>
        )}

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
              Infrastructure : MemorIA · Vérifiable via QR code · Généré le {fmtDateTime(generatedAt)}
            </Text>
          </View>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
            fixed
          />
        </View>
      </Page>
    </Document>
  )
}
