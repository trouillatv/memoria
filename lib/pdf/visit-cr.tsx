// PDF « Compte-rendu de visite » (@react-pdf/renderer).
//
// Sortie PARTAGEABLE du Débrief : rendu déterministe du même `VisitCrDoc` que le
// markdown (lib/db/visits.ts — source de vérité unique). Le CR RACONTE la visite :
// qui / où / quand → résumé → constats → OÙ (carte) → preuves → à retenir.
// Aucun fait inventé : ce qui n'a pas été relevé n'apparaît pas.
//
// Contraintes du format : polices Helvetica (WinAnsi) → PAS d'emoji couleur ni de
// glyphe « ✓ » (rendus en tofu) ; on utilise des pastilles/carrés colorés. Pas de
// fournisseur de tuiles configuré → la carte est un SCHÉMA (positions GPS
// relatives par type), pas une carte de rue.

import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { VisitCrDoc } from '@/lib/db/visits'

const COLORS = {
  text: '#0f172a',
  slate: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  accent: '#047857',      // emerald-700 — réservé aux titres IMPORTANTS
  accentBg: '#ecfdf5',    // emerald-50 — fond des encarts (résumé, à retenir)
  accentBorder: '#a7f3d0',
}

// Couleurs par type de capture — alignées sur la carte mobile (CaptureMap).
const KIND_COLOR: Record<string, string> = {
  photo: '#0284c7', video: '#7c3aed', vocal: '#d97706', note: '#475569', verification: '#059669', position: '#6b7280',
}
const KIND_LABEL: Record<string, string> = {
  photo: 'Photo', video: 'Vidéo', vocal: 'Vocal', note: 'Note', verification: 'Vérification', position: 'Position',
}

const MAP_W = 515
const MAP_H = 200

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica', fontSize: 10, color: COLORS.text,
    paddingTop: 36, paddingBottom: 52, paddingHorizontal: 40, lineHeight: 1.45,
  },
  // En-tête identité.
  header: { borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 10, marginBottom: 14 },
  headTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  siteName: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  kicker: { fontSize: 8, color: COLORS.accent, textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'Helvetica-Bold' },
  badge: {
    fontSize: 8, color: COLORS.accent, backgroundColor: COLORS.accentBg,
    borderWidth: 0.5, borderColor: COLORS.accentBorder, borderRadius: 3, paddingVertical: 2, paddingHorizontal: 6,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  metaItem: { fontSize: 9, color: COLORS.muted, marginRight: 14 },
  metaStrong: { fontFamily: 'Helvetica-Bold', color: COLORS.slate },

  section: { marginBottom: 13 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  titleGreen: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: COLORS.accent, textTransform: 'uppercase', letterSpacing: 0.5 },
  titleSlate: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: COLORS.slate, textTransform: 'uppercase', letterSpacing: 0.5 },
  subTitle: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6, marginBottom: 3 },

  paragraph: { marginBottom: 3 },
  empty: { color: COLORS.faint, fontStyle: 'italic' },
  bulletRow: { flexDirection: 'row', marginBottom: 2 },
  bulletDot: { width: 10, color: COLORS.muted },
  bulletText: { flex: 1 },
  rawRow: { flexDirection: 'row', marginBottom: 2 },
  rawText: { flex: 1, fontSize: 9, color: COLORS.muted, fontStyle: 'italic' },

  // Encart (résumé / à retenir).
  card: { backgroundColor: COLORS.accentBg, borderWidth: 0.5, borderColor: COLORS.accentBorder, borderRadius: 5, padding: 10 },
  cardLead: { fontFamily: 'Helvetica-Bold', color: COLORS.text, marginBottom: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  checkMark: { width: 6, height: 6, borderRadius: 1.5, backgroundColor: COLORS.accent, marginTop: 3, marginRight: 6 },

  // En bref (stats).
  statStrip: { flexDirection: 'row', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 5 },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRightWidth: 0.5, borderRightColor: COLORS.border },
  statCellLast: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  statN: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  statLabel: { fontSize: 7.5, color: COLORS.muted, marginTop: 2, textAlign: 'center' },

  // Photos.
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  photoCell: { width: 235, marginRight: 12, marginBottom: 8 },
  photo: { width: 235, height: 150, objectFit: 'cover', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 3 },
  photoCap: { fontSize: 9, marginTop: 3 },
  photoCapStrong: { fontFamily: 'Helvetica-Bold' },
  mediaNote: { fontSize: 9, color: COLORS.muted, marginTop: 2 },

  // Carte des observations (schéma).
  map: { width: MAP_W, height: MAP_H, backgroundColor: '#f1f5f9', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 5, position: 'relative' },
  marker: { position: 'absolute', width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: '#ffffff' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 4 },
  legendLabel: { fontSize: 8, color: COLORS.muted },
  caption: { fontSize: 8, color: COLORS.faint, marginTop: 4, fontStyle: 'italic' },

  footer: {
    position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 6, fontSize: 8, color: COLORS.faint,
  },
})

function SectionTitle({ text, color, important, sub }: { text: string; color: string; important?: boolean; sub?: string }) {
  return (
    <View style={styles.titleRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={important ? styles.titleGreen : styles.titleSlate}>{text}</Text>
      {sub ? <Text style={[styles.legendLabel, { marginLeft: 6 }]}>{sub}</Text> : null}
    </View>
  )
}

function Bullets({ items, empty }: { items: string[]; empty?: string }) {
  if (items.length === 0) return empty ? <Text style={styles.empty}>{empty}</Text> : null
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

// Carte SCHÉMATIQUE : positions GPS projetées à l'ÉCHELLE RÉELLE (mètres),
// centrées dans le cadre. Pas de fond de rue (aucun fournisseur de tuiles) → on
// montre l'agencement RÉEL des observations, coloré par type. Le zoom est plafonné
// (MIN_HALF_M) : deux points proches restent un petit amas central au lieu d'être
// étirés d'un coin à l'autre — ce qui « ne parlait pas ».
function ObservationMap({ positions }: { positions: VisitCrDoc['positions'] }) {
  const cLat = positions.reduce((s, p) => s + p.lat, 0) / positions.length
  const cLng = positions.reduce((s, p) => s + p.lng, 0) / positions.length
  const M_PER_DEG = 111_320
  const cosLat = Math.cos((cLat * Math.PI) / 180)
  // Décalage de chaque point par rapport au centre, en mètres (y vers le nord).
  const offsets = positions.map((p) => ({
    p,
    dx: (p.lng - cLng) * M_PER_DEG * cosLat,
    dy: (p.lat - cLat) * M_PER_DEG,
  }))
  const halfW = Math.max(...offsets.map((o) => Math.abs(o.dx)), 0)
  const halfH = Math.max(...offsets.map((o) => Math.abs(o.dy)), 0)
  const PAD = 0.14
  // Rayon minimal représenté : sous ~15 m d'étalement, on ne zoome pas davantage
  // (sinon un chantier de quelques mètres remplirait tout le cadre = illisible).
  const MIN_HALF_M = 15
  const scaleX = (MAP_W / 2) * (1 - PAD) / Math.max(halfW, MIN_HALF_M)
  const scaleY = (MAP_H / 2) * (1 - PAD) / Math.max(halfH, MIN_HALF_M)
  const scale = Math.min(scaleX, scaleY) // même échelle X/Y → géométrie vraie
  const kindsPresent = [...new Set(positions.map((p) => p.kind))]

  return (
    <View wrap={false}>
      <View style={styles.map}>
        {offsets.map((o, i) => {
          const left = MAP_W / 2 + o.dx * scale - 6
          const top = MAP_H / 2 - o.dy * scale - 6
          return <View key={i} style={[styles.marker, { left, top, backgroundColor: KIND_COLOR[o.p.kind] ?? '#6b7280' }]} />
        })}
      </View>
      <View style={styles.legend}>
        {kindsPresent.map((k) => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: KIND_COLOR[k] ?? '#6b7280' }]} />
            <Text style={styles.legendLabel}>{KIND_LABEL[k] ?? k}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption}>Emplacements relatifs des observations sur le chantier ({positions.length} point{positions.length > 1 ? 's' : ''}).</Text>
    </View>
  )
}

export function VisitCrPdf({ doc, exportDate }: { doc: VisitCrDoc; exportDate: string }) {
  // L'INTENTION spécialise le TITRE et quelques intitulés — mêmes données, cadrage
  // différent (première = référence · prévisite = appel d'offres · suivi = normal).
  const isPremiere = doc.motive === 'premiere'
  const isAo = doc.motive === 'previsite_ao'
  const kicker = isPremiere ? 'État initial du chantier' : isAo ? "Prévisite d'appel d'offres" : 'Compte-rendu de visite de chantier'
  const reservesTitle = isPremiere ? 'Premières réserves' : isAo ? 'Points de vigilance observés' : 'Réserves'
  const actionsTitle = isPremiere ? 'Premières actions' : 'Actions à réaliser'
  const photosBase = isPremiere ? 'Photos de référence' : 'Photos clés'
  const title = `${kicker} — ${doc.siteName}`

  const reserveLines = [
    ...doc.reserves.map((r) => `${r.label}${r.location ? ` (${r.location})` : ''}`),
    ...doc.points.reserve,
  ]
  const actionLines = [
    ...doc.actions.map((a) => `${a.corps_etat ? `(${a.corps_etat}) ` : ''}${a.title}`),
    ...doc.points.action,
  ]

  // « En bref » — richesse de la visite (comptes réels par type).
  const stats: Array<{ n: number; label: string }> = [
    { n: doc.photoCount, label: doc.photoCount > 1 ? 'photos' : 'photo' },
    { n: doc.videoCount, label: doc.videoCount > 1 ? 'vidéos' : 'vidéo' },
    { n: doc.vocalCount, label: doc.vocalCount > 1 ? 'mémos vocaux' : 'mémo vocal' },
    { n: doc.noteCount, label: doc.noteCount > 1 ? 'notes écrites' : 'note écrite' },
    { n: doc.verificationCount, label: doc.verificationCount > 1 ? 'vérifications' : 'vérification' },
    { n: doc.starredCount, label: doc.starredCount > 1 ? 'éléments marqués' : 'élément marqué' },
  ]

  // « À retenir » — la conclusion : ce que la visite a enrichi.
  const preuves = doc.photoCount + doc.videoCount + doc.vocalCount
  const retenir: string[] = []
  if (preuves > 0) retenir.push(`${preuves} nouvelle${preuves > 1 ? 's' : ''} preuve${preuves > 1 ? 's' : ''} ajoutée${preuves > 1 ? 's' : ''}`)
  if (reserveLines.length > 0) retenir.push(`${reserveLines.length} réserve${reserveLines.length > 1 ? 's' : ''} créée${reserveLines.length > 1 ? 's' : ''}`)
  if (actionLines.length > 0) retenir.push(`${actionLines.length} action${actionLines.length > 1 ? 's' : ''} créée${actionLines.length > 1 ? 's' : ''}`)
  retenir.push('Compte-rendu généré et disponible')

  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        {/* En-tête identité : qui / où / quand, avant même le résumé. */}
        <View style={styles.header} fixed>
          <View style={styles.headTop}>
            <View>
              <Text style={styles.kicker}>{kicker}</Text>
              <Text style={styles.siteName}>{doc.siteName}</Text>
            </View>
            <Text style={styles.badge}>{doc.typeLabel}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaItem}>{doc.dateLabel}</Text>
            {doc.authorName ? <Text style={styles.metaItem}><Text style={styles.metaStrong}>Conducteur : </Text>{doc.authorName}</Text> : null}
            {doc.clientName ? <Text style={styles.metaItem}><Text style={styles.metaStrong}>Client : </Text>{doc.clientName}</Text> : null}
            {doc.city ? <Text style={styles.metaItem}>{doc.city}</Text> : null}
            {doc.durationLabel ? <Text style={styles.metaItem}><Text style={styles.metaStrong}>Durée : </Text>{doc.durationLabel}</Text> : null}
          </View>
        </View>

        {/* Résumé — encart, ce que le lecteur doit voir en premier. */}
        <View style={styles.section} wrap={false}>
          <SectionTitle text="Résumé de la visite" color={COLORS.accent} important />
          <View style={styles.card}>
            <Text style={doc.summary ? undefined : styles.empty}>
              {doc.summary?.trim() || 'Éléments insuffisants pour un résumé — voir les constats et photos ci-dessous.'}
            </Text>
          </View>
        </View>

        {/* En bref — richesse de la visite en un coup d'œil. */}
        <View style={styles.section} wrap={false}>
          <SectionTitle text="En bref — contenu de la visite" color={COLORS.muted} />
          <View style={styles.statStrip}>
            {stats.map((s, i) => (
              <View key={i} style={i === stats.length - 1 ? styles.statCellLast : styles.statCell}>
                <Text style={styles.statN}>{s.n}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Objet — seulement s'il est renseigné (pas de section vide). */}
        {(doc.objective || doc.subjectName) && (
          <View style={styles.section} wrap={false}>
            <SectionTitle text={isPremiere || isAo ? 'Contexte' : 'Objet de la visite'} color={COLORS.muted} />
            {doc.objective ? <Text style={styles.paragraph}>{doc.objective}</Text> : null}
            {doc.subjectName ? <Text style={styles.paragraph}>Sujet : {doc.subjectName}</Text> : null}
          </View>
        )}

        {/* Constats — écrits en clair, transcriptions vocales brutes reléguées dessous. */}
        <View style={styles.section}>
          <SectionTitle text="Constats de la visite" color={COLORS.accent} important />
          {doc.observations.length === 0 && doc.transcriptions.length === 0 ? (
            <Text style={styles.empty}>Aucune note saisie pendant la visite.</Text>
          ) : (
            <>
              <Bullets items={doc.observations} />
              {doc.transcriptions.length > 0 && (
                <>
                  <Text style={styles.subTitle}>Transcriptions brutes (extraits)</Text>
                  <View>
                    {doc.transcriptions.map((line, i) => (
                      <View key={i} style={styles.rawRow} wrap={false}>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.rawText}>{line}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </>
          )}
        </View>

        {reserveLines.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text={reservesTitle} color="#e11d48" />
            <Bullets items={reserveLines} />
          </View>
        )}

        {doc.points.surveiller.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Points à surveiller" color="#d97706" />
            <Bullets items={doc.points.surveiller} />
          </View>
        )}

        {/* Localisation — le « où » AVANT les preuves. Uniquement si des GPS existent. */}
        {doc.positions.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Localisation des observations" color="#0284c7" />
            <ObservationMap positions={doc.positions} />
          </View>
        )}

        {/* Photos — avec légendes, pour comprendre sans rouvrir l'app. */}
        {doc.photoItems.length > 0 && (
          <View style={styles.section}>
            <SectionTitle
              text={photosBase}
              color={COLORS.accent}
              important
              sub={doc.photoCount > doc.photoItems.length ? `${doc.photoItems.length} sur ${doc.photoCount}` : `${doc.photoItems.length}`}
            />
            <View style={styles.photoGrid}>
              {doc.photoItems.map((p, i) => (
                <View key={i} style={styles.photoCell} wrap={false}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
                  <Image src={p.url} style={styles.photo} />
                  <Text style={styles.photoCap}>
                    <Text style={styles.photoCapStrong}>Photo {i + 1}</Text>
                    {p.caption ? ` — ${p.caption}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {(doc.videoCount > 0 || doc.vocalCount > 0) && (
          <Text style={styles.mediaNote}>
            Autres médias :{' '}
            {[
              doc.videoCount > 0 ? `${doc.videoCount} vidéo${doc.videoCount > 1 ? 's' : ''}` : null,
              doc.vocalCount > 0 ? `${doc.vocalCount} ${doc.vocalCount > 1 ? 'mémos vocaux' : 'mémo vocal'}` : null,
            ].filter(Boolean).join(' · ')}{' '}
            — consultables dans la visite.
          </Text>
        )}

        {actionLines.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text={actionsTitle} color="#7c3aed" />
            <Bullets items={actionLines} />
          </View>
        )}

        {/* À retenir — la conclusion naturelle du document. */}
        <View style={styles.section} wrap={false}>
          <SectionTitle text="À retenir" color={COLORS.accent} important />
          <View style={styles.card}>
            <Text style={styles.cardLead}>Cette visite a enrichi la mémoire du chantier.</Text>
            {retenir.map((line, i) => (
              <View key={i} style={styles.checkRow}>
                <View style={styles.checkMark} />
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Bilan — résultat / suivi (posés à la clôture, souvent « non précisé »). */}
        <View style={styles.section} wrap={false}>
          <SectionTitle text="Bilan" color={COLORS.muted} />
          <Text style={styles.paragraph}><Text style={styles.metaStrong}>Résultat : </Text>{doc.outcomeLabel ?? 'non précisé'}</Text>
          <Text style={styles.paragraph}><Text style={styles.metaStrong}>Suivi : </Text>{doc.resolutionLabel ?? 'non précisé'}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>Compte-rendu généré par MemorIA · {exportDate}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
