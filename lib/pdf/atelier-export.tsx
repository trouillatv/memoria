// Sprint 8 — Export Atelier IA → Dossier de préparation PDF.
//
// Doctrine V5 :
//   - Pilier 4 (DG amplifié) : PDF amplifie Guillaume, ne parle pas à sa place.
//   - Verrou V1 (mémoire ≠ recommandation) : descriptif factuel uniquement.
//     Pas de "Baissez votre prix", pas de superlatif marketing.
//   - Pilier 6 (infrastructure invisible) : prestataire en hero, MemorIA en
//     footer.
//   - Sobriété B2B. Pas de QR code (doc interne, pas vérifiable comme un
//     dossier de preuves Phase 5).
//
// Wording strict :
//   ✅ Faits, chiffres, citations directes
//   ❌ "Leader", "Excellent", "Reconnu", "Notre expertise", "Nous démontrons"
//
// Le PDF est un **document de PREUVE assemblée**, pas une plaquette
// commerciale. Sa valeur est dans la densité des faits, pas dans la
// formulation.

import React from 'react'
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { AtelierExportData } from '@/lib/db/atelier-export'
import type { EngagementCategory } from '@/types/db'

// ----------------------------------------------------------------------------
// Constantes
// ----------------------------------------------------------------------------

/** Plafond engagements affichés en page "Engagements identifiés". */
export const MAX_ENGAGEMENTS_LISTED = 20
/** Plafond AO similaires affichés. */
export const MAX_SIMILAR_TENDERS = 5
/** Plafond messages d'échange Atelier listés. */
export const MAX_CHAT_MESSAGES_LISTED = 200

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
    paddingBottom: 56,
    paddingHorizontal: 36,
    lineHeight: 1.4,
  },

  // Cover page
  coverPage: {
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: COLORS.text,
    paddingTop: 80,
    paddingBottom: 60,
    paddingHorizontal: 48,
    lineHeight: 1.5,
  },
  coverBrand: {
    fontSize: 16,
    fontWeight: 700,
    color: COLORS.accent,
    letterSpacing: 2,
    marginBottom: 6,
  },
  coverBrandSubtitle: {
    fontSize: 10,
    color: COLORS.muted,
    marginBottom: 80,
    letterSpacing: 0.6,
  },
  coverTitle: {
    fontSize: 26,
    fontWeight: 700,
    marginBottom: 12,
  },
  coverSubtitle: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 4,
  },
  coverClient: {
    fontSize: 12,
    color: COLORS.muted,
    marginBottom: 24,
  },
  coverMetaRow: {
    flexDirection: 'row',
    marginTop: 36,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  coverMetaCell: { flex: 1, paddingRight: 8 },
  coverMetaLabel: {
    fontSize: 8,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  coverMetaValue: { fontSize: 10, fontWeight: 700 },
  coverIntro: {
    fontSize: 10,
    color: COLORS.muted,
    marginTop: 48,
    fontStyle: 'italic',
    lineHeight: 1.6,
  },

  // Header (intra page)
  pageHeader: {
    fontSize: 9,
    color: COLORS.muted,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 6,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  // Sections
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 10,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  subsectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 10,
    marginBottom: 4,
    color: COLORS.text,
  },
  paragraph: { marginBottom: 6, fontSize: 10 },
  empty: { fontStyle: 'italic', color: COLORS.faint, fontSize: 9 },

  // Key-value lines
  kvRow: { flexDirection: 'row', marginBottom: 3 },
  kvLabel: {
    width: 110,
    fontSize: 9,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  kvValue: { flex: 1, fontSize: 10 },

  // Engagement item
  engagementItem: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: 8,
    marginBottom: 6,
  },
  engagementLabel: { fontSize: 10, fontWeight: 700 },
  engagementSource: {
    fontSize: 9,
    color: COLORS.muted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  categoryHeader: {
    fontSize: 10,
    fontWeight: 700,
    marginTop: 8,
    marginBottom: 4,
    color: COLORS.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Similar tenders
  similarItem: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: 8,
    marginBottom: 6,
  },
  similarTitle: { fontSize: 10, fontWeight: 700 },
  similarReason: {
    fontSize: 9,
    color: COLORS.muted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  similarLost: { borderLeftColor: '#fca5a5' },
  similarWon: { borderLeftColor: '#86efac' },
  similarNeutral: { borderLeftColor: COLORS.border },

  // Evidence per engagement
  evidenceBlock: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.border,
    paddingLeft: 8,
    marginBottom: 8,
  },
  evidenceTitle: { fontSize: 10, fontWeight: 700, marginBottom: 2 },
  evidenceContractLine: {
    fontSize: 9,
    color: COLORS.text,
    marginTop: 2,
  },

  // Forces
  forcesBullet: {
    fontSize: 11,
    marginBottom: 6,
    paddingLeft: 6,
  },

  // Agent syntheses
  agentBlock: {
    marginBottom: 12,
    padding: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
  },
  agentRoleBadge: {
    fontSize: 7,
    color: COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  agentLabel: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  agentContent: { fontSize: 9, lineHeight: 1.5 },

  // Chat
  chatMessage: {
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  chatMessageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  chatSender: { fontSize: 10, fontWeight: 700 },
  chatTime: { fontSize: 8, color: COLORS.muted },
  chatBody: { fontSize: 9, lineHeight: 1.45 },
  chatAttachment: {
    fontSize: 8,
    color: COLORS.muted,
    marginTop: 3,
    fontStyle: 'italic',
  },
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
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
  footerLeft: { fontSize: 7, color: COLORS.faint, flex: 1 },
  pageNumber: { fontSize: 8, color: COLORS.muted },
})

// ----------------------------------------------------------------------------
// Helpers de formatage
// ----------------------------------------------------------------------------

function fmtDateLong(iso: string | null | undefined): string {
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

function fmtDateMonth(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const month = d.toLocaleDateString('fr-FR', { month: 'long' })
    return `${capitalize(month)} ${d.getFullYear()}`
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

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

function truncateTitle(title: string, max = 48): string {
  if (!title) return ''
  if (title.length <= max) return title
  return title.slice(0, max - 1).trimEnd() + '…'
}

const CATEGORY_LABELS: Record<EngagementCategory, string> = {
  frequency: 'Fréquence',
  quality: 'Qualité',
  compliance: 'Conformité',
  delivery: 'Livrables',
  sla: 'SLA',
  reporting: 'Reporting',
  other: 'Autres',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  uploaded: 'Uploadé',
  parsing: 'Analyse en cours',
  ready: 'Prêt',
  failed: 'Échec',
  archived: 'Archivé',
}

const OUTCOME_LABELS: Record<string, string> = {
  won: 'Gagné',
  lost: 'Perdu',
  withdrawn: 'Retiré',
  not_responded: 'Non répondu',
  pending: 'En attente',
}

const OUTCOME_TAG_LABELS: Record<string, string> = {
  prix: 'prix',
  qualite: 'qualité',
  relation: 'relation',
  timing: 'timing',
  autre: 'autre',
}

const AGENT_NAME_LABELS: Record<string, string> = {
  general: 'Général',
  lecteur_ao: 'Lecteur AO',
  memoire_technique: 'Mémoire technique',
  contradicteur: 'Contradicteur',
  financier: 'Financier',
  terrain: 'Terrain',
  conformite: 'Conformité',
}

const ROLE_LABELS: Record<string, string> = {
  commerciale: 'Commerciale',
  strategique: 'Stratégique',
  operationnelle: 'Opérationnelle',
}

/**
 * Markdown léger : retire les marqueurs de gras/italique/code/headers,
 * renvoie des paragraphes propres pour rendu @react-pdf (qui ne fait pas de
 * vrai markdown). On garde les retours à la ligne et les listes simples.
 */
function stripMarkdown(md: string): string[] {
  if (!md) return []
  const cleaned = md
    .replace(/```[\s\S]*?```/g, '') // remove fenced code
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/__([^_]+)__/g, '$1') // bold underscore
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2') // italic
    .replace(/(^|\s)_([^_\n]+)_/g, '$1$2') // italic underscore
    .replace(/^#{1,6}\s+/gm, '') // headers
    .replace(/^\s*[-*+]\s+/gm, '• ') // bullets
    .replace(/^\s*\d+\.\s+/gm, '• ') // numbered lists
    .replace(/^>\s+/gm, '') // blockquote markers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links

  // Split on double newlines into paragraphs, single newlines kept inside.
  return cleaned
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, (m) => (m.includes('\n') ? m : ' ')).trim())
    .filter((p) => p.length > 0)
}

function senderLabel(
  m: {
    role: 'user' | 'agent' | 'system'
    agent_name: string | null
  },
): string {
  if (m.role === 'user') return 'Guillaume'
  if (m.role === 'system') return 'Système'
  if (m.agent_name && AGENT_NAME_LABELS[m.agent_name])
    return `Agent · ${AGENT_NAME_LABELS[m.agent_name]}`
  return 'Agent'
}

// ----------------------------------------------------------------------------
// Footer fixe — sobre, MemorIA en pied de page
// ----------------------------------------------------------------------------

function AtelierFooter({
  shortTitle,
}: {
  shortTitle: string
}) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerLeft}>
        Dossier de préparation · {shortTitle} · Préparé avec MemorIA
      </Text>
      <Text
        style={styles.pageNumber}
        render={({ pageNumber, totalPages }) =>
          `Page ${pageNumber} / ${totalPages}`
        }
        fixed
      />
    </View>
  )
}

// ----------------------------------------------------------------------------
// Composant principal
// ----------------------------------------------------------------------------

export interface AtelierExportPdfProps {
  data: AtelierExportData
}

export function AtelierExportPdf({ data }: AtelierExportPdfProps) {
  const shortTitle = truncateTitle(data.tender.title || 'AO', 60)
  const tenantHero = (data.tenantName ?? '').trim() || 'Votre entreprise'

  // Group engagements by category
  const engagementsByCategory = new Map<
    EngagementCategory,
    typeof data.engagements
  >()
  for (const e of data.engagements) {
    const arr = engagementsByCategory.get(e.category) ?? []
    arr.push(e)
    engagementsByCategory.set(e.category, arr)
  }
  const totalEngagements = data.engagements.length
  const engagementsShown = Math.min(totalEngagements, MAX_ENGAGEMENTS_LISTED)
  const engagementsOverflow = Math.max(
    0,
    totalEngagements - MAX_ENGAGEMENTS_LISTED,
  )

  // Build flat list capped at MAX_ENGAGEMENTS_LISTED while keeping category order
  const orderedCategories: EngagementCategory[] = [
    'frequency',
    'quality',
    'compliance',
    'delivery',
    'sla',
    'reporting',
    'other',
  ]
  const limitedByCategory: Array<{
    category: EngagementCategory
    items: typeof data.engagements
  }> = []
  {
    let remaining = MAX_ENGAGEMENTS_LISTED
    for (const cat of orderedCategories) {
      if (remaining <= 0) break
      const items = engagementsByCategory.get(cat) ?? []
      if (items.length === 0) continue
      const taken = items.slice(0, remaining)
      limitedByCategory.push({ category: cat, items: taken })
      remaining -= taken.length
    }
  }

  // Engagements with evidence for "Preuves disponibles"
  const engagementsWithEvidence = data.engagements
    .map((e) => ({ engagement: e, evidence: data.evidence.get(e.id) }))
    .filter((row) => {
      const ev = row.evidence
      return ev && ev.interventionsExecuted > 0
    }) as Array<{
    engagement: (typeof data.engagements)[number]
    evidence: NonNullable<ReturnType<typeof data.evidence.get>>
  }>

  // Chat messages with attachments grouped by message id
  const attachmentsByMessage = new Map<string, typeof data.chatAttachments>()
  for (const att of data.chatAttachments) {
    const arr = attachmentsByMessage.get(att.message_id) ?? []
    arr.push(att)
    attachmentsByMessage.set(att.message_id, arr)
  }
  const chatToShow = data.chatMessages.slice(0, MAX_CHAT_MESSAGES_LISTED)
  const chatOverflow = Math.max(
    0,
    data.chatMessages.length - MAX_CHAT_MESSAGES_LISTED,
  )

  // Agent syntheses grouped by role
  const agentsByRole = new Map<string, typeof data.agentSyntheses>()
  for (const a of data.agentSyntheses) {
    const arr = agentsByRole.get(a.role) ?? []
    arr.push(a)
    agentsByRole.set(a.role, arr)
  }
  const hasAnyAgentSynthesis = data.agentSyntheses.length > 0

  return (
    <Document
      title={`Dossier de préparation — ${shortTitle}`}
      author={tenantHero}
      subject="Dossier de préparation AO"
      creator="MemorIA — Dossier de préparation"
    >
      {/* ================================================================== */}
      {/* Page 1 — Couverture                                                  */}
      {/* ================================================================== */}
      <Page size="A4" style={styles.coverPage}>
        <Text style={styles.coverBrand}>{tenantHero.toUpperCase()}</Text>
        <Text style={styles.coverBrandSubtitle}>Dossier de préparation</Text>

        <Text style={styles.coverTitle}>Dossier de préparation</Text>
        <Text style={styles.coverSubtitle}>{data.tender.title}</Text>
        {data.tender.client_name && (
          <Text style={styles.coverClient}>{data.tender.client_name}</Text>
        )}

        <View style={styles.coverMetaRow}>
          <View style={styles.coverMetaCell}>
            <Text style={styles.coverMetaLabel}>Assemblé le</Text>
            <Text style={styles.coverMetaValue}>
              {fmtDateLong(data.generatedAt)}
            </Text>
          </View>
          <View style={styles.coverMetaCell}>
            <Text style={styles.coverMetaLabel}>Statut</Text>
            <Text style={styles.coverMetaValue}>
              {STATUS_LABELS[data.tender.status] ?? data.tender.status}
            </Text>
          </View>
          <View style={styles.coverMetaCell}>
            <Text style={styles.coverMetaLabel}>Engagements</Text>
            <Text style={styles.coverMetaValue}>{totalEngagements}</Text>
          </View>
        </View>

        <Text style={styles.coverIntro}>
          Dossier de préparation pour l&apos;appel d&apos;offres «{' '}
          {data.tender.title} ». Assemblé le {fmtDateLong(data.generatedAt)} à
          partir du capital opérationnel de l&apos;entreprise (engagements
          extraits, preuves accumulées, échanges Atelier IA).
        </Text>

        <AtelierFooter shortTitle={shortTitle} />
      </Page>

      {/* ================================================================== */}
      {/* Page 2 — Contexte                                                    */}
      {/* ================================================================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text>{tenantHero.toUpperCase()}</Text>
          <Text>Contexte</Text>
        </View>

        <Text style={styles.sectionTitle}>Contexte de l&apos;appel d&apos;offres</Text>

        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Client</Text>
          <Text style={styles.kvValue}>
            {data.tender.client_name ?? '— non renseigné'}
          </Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Objet</Text>
          <Text style={styles.kvValue}>{data.tender.title}</Text>
        </View>

        <Text style={styles.subsectionTitle}>Dates clés</Text>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Reçu le</Text>
          <Text style={styles.kvValue}>
            {fmtDateLong(data.context.keyDates.received)}
          </Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvLabel}>Échéance</Text>
          <Text style={styles.kvValue}>
            {fmtDateLong(data.context.keyDates.deadline)}
          </Text>
        </View>
        {data.context.keyDates.submitted && (
          <View style={styles.kvRow}>
            <Text style={styles.kvLabel}>Déposé le</Text>
            <Text style={styles.kvValue}>
              {fmtDateLong(data.context.keyDates.submitted)}
            </Text>
          </View>
        )}

        {data.context.technicalMemoExcerpt && (
          <>
            <Text style={styles.subsectionTitle}>Extrait du mémoire technique</Text>
            <Text style={styles.paragraph}>
              {data.context.technicalMemoExcerpt}
              {data.context.technicalMemoExcerpt.length >= 600 ? '…' : ''}
            </Text>
          </>
        )}

        <AtelierFooter shortTitle={shortTitle} />
      </Page>

      {/* ================================================================== */}
      {/* Page 3 — Engagements identifiés                                      */}
      {/* ================================================================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text>{tenantHero.toUpperCase()}</Text>
          <Text>Engagements identifiés</Text>
        </View>

        <Text style={styles.sectionTitle}>
          Engagements identifiés ({totalEngagements})
        </Text>

        {totalEngagements === 0 && (
          <Text style={styles.empty}>
            Aucun engagement extrait pour cet appel d&apos;offres.
          </Text>
        )}

        {limitedByCategory.map(({ category, items }) => (
          <View key={category}>
            <Text style={styles.categoryHeader}>
              {CATEGORY_LABELS[category]} ({items.length})
            </Text>
            {items.map((e) => (
              <View key={e.id} style={styles.engagementItem} wrap={false}>
                <Text style={styles.engagementLabel}>{e.short_label || '—'}</Text>
                {e.source_excerpt && (
                  <Text style={styles.engagementSource}>
                    «&nbsp;{e.source_excerpt}&nbsp;»
                  </Text>
                )}
              </View>
            ))}
          </View>
        ))}

        {engagementsOverflow > 0 && (
          <Text style={styles.overflowNote}>
            {engagementsOverflow} autre{engagementsOverflow > 1 ? 's' : ''}{' '}
            engagement{engagementsOverflow > 1 ? 's' : ''} non affiché
            {engagementsOverflow > 1 ? 's' : ''} dans ce résumé.{' '}
            {engagementsShown} sur {totalEngagements} listé
            {engagementsShown > 1 ? 's' : ''}.
          </Text>
        )}

        <AtelierFooter shortTitle={shortTitle} />
      </Page>

      {/* ================================================================== */}
      {/* Page 4 — Mémoire des AO similaires                                   */}
      {/* ================================================================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text>{tenantHero.toUpperCase()}</Text>
          <Text>Mémoire des AO similaires</Text>
        </View>

        <Text style={styles.sectionTitle}>Mémoire des AO similaires</Text>

        {data.similarTenders.length === 0 && (
          <Text style={styles.empty}>
            Aucun appel d&apos;offres similaire identifié dans la mémoire
            commerciale.
          </Text>
        )}

        {data.similarTenders.slice(0, MAX_SIMILAR_TENDERS).map((st) => {
          const itemStyle = [
            styles.similarItem,
            st.outcome === 'lost'
              ? styles.similarLost
              : st.outcome === 'won'
                ? styles.similarWon
                : styles.similarNeutral,
          ]
          const tag = st.outcome_tag
            ? OUTCOME_TAG_LABELS[st.outcome_tag] ?? st.outcome_tag
            : null
          const outcomeLabel = OUTCOME_LABELS[st.outcome] ?? st.outcome
          return (
            <View key={st.id} style={itemStyle} wrap={false}>
              <Text style={styles.similarTitle}>
                {fmtDateMonth(st.outcome_at ?? null)} — {st.title}
                {st.client_name ? ` — ${st.client_name}` : ''} — {outcomeLabel}
                {tag ? ` (${tag})` : ''}
              </Text>
              {st.outcome_reason && (
                <Text style={styles.similarReason}>
                  «&nbsp;{st.outcome_reason}&nbsp;»
                </Text>
              )}
            </View>
          )
        })}

        <AtelierFooter shortTitle={shortTitle} />
      </Page>

      {/* ================================================================== */}
      {/* Page 5-6 — Preuves disponibles (par engagement)                       */}
      {/* ================================================================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text>{tenantHero.toUpperCase()}</Text>
          <Text>Preuves disponibles</Text>
        </View>

        <Text style={styles.sectionTitle}>
          Preuves disponibles ({engagementsWithEvidence.length} engagement
          {engagementsWithEvidence.length > 1 ? 's' : ''} couvert
          {engagementsWithEvidence.length > 1 ? 's' : ''})
        </Text>

        {engagementsWithEvidence.length === 0 && (
          <Text style={styles.empty}>
            Aucune preuve d&apos;exécution rattachée aux engagements de cet
            appel d&apos;offres pour l&apos;instant.
          </Text>
        )}

        {engagementsWithEvidence.map(({ engagement, evidence }) => {
          const contracts = evidence.contractNames
          return (
            <View key={engagement.id} style={styles.evidenceBlock} wrap={false}>
              <Text style={styles.evidenceTitle}>{engagement.short_label}</Text>
              {contracts.length === 0 ? (
                <Text style={styles.evidenceContractLine}>
                  {evidence.interventionsExecuted} intervention
                  {evidence.interventionsExecuted > 1 ? 's' : ''} documentée
                  {evidence.interventionsExecuted > 1 ? 's' : ''} ·{' '}
                  {evidence.photosCount} photo
                  {evidence.photosCount > 1 ? 's' : ''} ·{' '}
                  {evidence.anomaliesResolved + evidence.anomaliesOpen} incident
                  {evidence.anomaliesResolved + evidence.anomaliesOpen > 1
                    ? 's'
                    : ''}{' '}
                  traité
                  {evidence.anomaliesResolved + evidence.anomaliesOpen > 1
                    ? 's'
                    : ''}
                </Text>
              ) : (
                contracts.map((cn: string) => (
                  <Text key={cn} style={styles.evidenceContractLine}>
                    Contrat {cn} — {evidence.interventionsExecuted}{' '}
                    intervention{evidence.interventionsExecuted > 1 ? 's' : ''}{' '}
                    documentée{evidence.interventionsExecuted > 1 ? 's' : ''}{' '}
                    · {evidence.photosCount} photo
                    {evidence.photosCount > 1 ? 's' : ''} ·{' '}
                    {evidence.anomaliesResolved + evidence.anomaliesOpen}{' '}
                    incident
                    {evidence.anomaliesResolved + evidence.anomaliesOpen > 1
                      ? 's'
                      : ''}{' '}
                    traité
                    {evidence.anomaliesResolved + evidence.anomaliesOpen > 1
                      ? 's'
                      : ''}
                  </Text>
                ))
              )}
            </View>
          )
        })}

        <AtelierFooter shortTitle={shortTitle} />
      </Page>

      {/* ================================================================== */}
      {/* Page 7 — Forces de l'entreprise (faits, jamais superlatifs)         */}
      {/* ================================================================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text>{tenantHero.toUpperCase()}</Text>
          <Text>Capital opérationnel</Text>
        </View>

        <Text style={styles.sectionTitle}>Capital opérationnel</Text>

        <Text style={styles.forcesBullet}>
          • {data.forces.activeContractsCount} contrat
          {data.forces.activeContractsCount > 1 ? 's' : ''} actif
          {data.forces.activeContractsCount > 1 ? 's' : ''}.
        </Text>
        <Text style={styles.forcesBullet}>
          • {data.forces.totalPhotos.toLocaleString('fr-FR')} photo
          {data.forces.totalPhotos > 1 ? 's' : ''} accumulée
          {data.forces.totalPhotos > 1 ? 's' : ''} depuis le démarrage.
        </Text>
        <Text style={styles.forcesBullet}>
          • {data.forces.totalInterventions.toLocaleString('fr-FR')}{' '}
          intervention{data.forces.totalInterventions > 1 ? 's' : ''}{' '}
          documentée{data.forces.totalInterventions > 1 ? 's' : ''}.
        </Text>
        {data.forces.firstContractStartDate && (
          <Text style={styles.forcesBullet}>
            • Continuité opérationnelle depuis le{' '}
            {fmtDateLong(data.forces.firstContractStartDate)}.
          </Text>
        )}
        {data.forces.daysSinceFirstContract !== null && (
          <Text style={styles.forcesBullet}>
            • {data.forces.daysSinceFirstContract.toLocaleString('fr-FR')} jour
            {data.forces.daysSinceFirstContract > 1 ? 's' : ''} de capital
            mémoriel accumulé.
          </Text>
        )}

        <AtelierFooter shortTitle={shortTitle} />
      </Page>

      {/* ================================================================== */}
      {/* Page 8 — Synthèse analyses agents (si présentes — silence positif)  */}
      {/* ================================================================== */}
      {hasAnyAgentSynthesis && (
        <Page size="A4" style={styles.page}>
          <View style={styles.pageHeader}>
            <Text>{tenantHero.toUpperCase()}</Text>
            <Text>Synthèse des analyses agents</Text>
          </View>

          <Text style={styles.sectionTitle}>Synthèse des analyses agents</Text>

          {(['commerciale', 'strategique', 'operationnelle'] as const).map(
            (role) => {
              const arr = agentsByRole.get(role) ?? []
              if (arr.length === 0) return null
              return (
                <View key={role}>
                  <Text style={styles.subsectionTitle}>
                    {ROLE_LABELS[role]}
                  </Text>
                  {arr.map((a) => {
                    const paragraphs = stripMarkdown(a.content)
                    return (
                      <View key={a.agentName} style={styles.agentBlock} wrap={false}>
                        <Text style={styles.agentRoleBadge}>
                          {ROLE_LABELS[a.role]}
                        </Text>
                        <Text style={styles.agentLabel}>{a.label}</Text>
                        {paragraphs.length === 0 ? (
                          <Text style={styles.empty}>(synthèse vide)</Text>
                        ) : (
                          paragraphs.map((p, i) => (
                            <Text
                              key={i}
                              style={
                                i > 0
                                  ? [styles.agentContent, { marginTop: 4 }]
                                  : styles.agentContent
                              }
                            >
                              {p}
                            </Text>
                          ))
                        )}
                      </View>
                    )
                  })}
                </View>
              )
            },
          )}

          <AtelierFooter shortTitle={shortTitle} />
        </Page>
      )}

      {/* ================================================================== */}
      {/* Page 9+ — Échanges Atelier IA (chronologique)                        */}
      {/* ================================================================== */}
      <Page size="A4" style={styles.page}>
        <View style={styles.pageHeader}>
          <Text>{tenantHero.toUpperCase()}</Text>
          <Text>Échanges Atelier IA</Text>
        </View>

        <Text style={styles.sectionTitle}>
          Échanges Atelier IA ({data.chatMessages.length})
        </Text>

        {chatToShow.length === 0 && (
          <Text style={styles.empty}>
            Aucun échange enregistré dans l&apos;Atelier IA pour cet appel
            d&apos;offres.
          </Text>
        )}

        {chatToShow.map((m) => {
          const paragraphs = stripMarkdown(m.content || '')
          const atts = attachmentsByMessage.get(m.id) ?? []
          return (
            <View key={m.id} style={styles.chatMessage} wrap={false}>
              <View style={styles.chatMessageHeader}>
                <Text style={styles.chatSender}>{senderLabel(m)}</Text>
                <Text style={styles.chatTime}>{fmtDateTime(m.created_at)}</Text>
              </View>
              {paragraphs.length === 0 ? (
                <Text style={styles.empty}>(message vide)</Text>
              ) : (
                paragraphs.map((p, i) => (
                  <Text
                    key={i}
                    style={
                      i > 0
                        ? [styles.chatBody, { marginTop: 3 }]
                        : styles.chatBody
                    }
                  >
                    {p}
                  </Text>
                ))
              )}
              {atts.length > 0 && (
                <Text style={styles.chatAttachment}>
                  Pièce{atts.length > 1 ? 's' : ''} jointe
                  {atts.length > 1 ? 's' : ''} :{' '}
                  {atts.map((a) => a.filename).join(', ')}
                </Text>
              )}
            </View>
          )
        })}

        {chatOverflow > 0 && (
          <Text style={styles.overflowNote}>
            {chatOverflow} message{chatOverflow > 1 ? 's' : ''}{' '}
            supplémentaire{chatOverflow > 1 ? 's' : ''} non affiché
            {chatOverflow > 1 ? 's' : ''} dans cet export.
          </Text>
        )}

        <AtelierFooter shortTitle={shortTitle} />
      </Page>
    </Document>
  )
}

// ----------------------------------------------------------------------------
// Render helper — utilisé par la route GET.
// ----------------------------------------------------------------------------

export async function renderAtelierExportPdf(
  data: AtelierExportData,
): Promise<Buffer> {
  return renderToBuffer(<AtelierExportPdf data={data} />)
}
