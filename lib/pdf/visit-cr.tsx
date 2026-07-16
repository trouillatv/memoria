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
import type { StoredDebriefAnalysis } from '@/lib/visits/debrief-analysis'
import { echeanceLine } from '@/lib/visits/echeance-labels'

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

  // Action proposée : une case à COCHER (à faire), pas une puce.
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 },
  checkbox: { width: 9, height: 9, borderWidth: 1, borderColor: '#7c3aed', borderRadius: 2, marginTop: 2, marginRight: 7 },
  checkboxDone: { width: 9, height: 9, borderWidth: 1, borderColor: '#7c3aed', borderRadius: 2, marginTop: 2, marginRight: 7, backgroundColor: '#7c3aed' },
  actionDone: { textDecoration: 'line-through', color: COLORS.muted },
  actionText: { flex: 1 },
  actionWhy: { fontSize: 8.5, color: COLORS.muted },
  // Point de vigilance : une ALERTE (pastille orange), lisible en 3 secondes.
  alertRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 },
  alertDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f59e0b', marginTop: 2.5, marginRight: 7 },

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

  // Évolution — même point de vue (mig 195) : une bande par série, ≤4 jalons.
  evoBlock: { marginBottom: 8 },
  evoLabel: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: COLORS.slate, marginBottom: 3 },
  evoRow: { flexDirection: 'row' },
  evoCell: { width: 120, marginRight: 8 },
  evoPhoto: { width: 120, height: 80, objectFit: 'cover', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 3 },
  evoDate: { fontSize: 7.5, color: COLORS.muted, marginTop: 2, textAlign: 'center' },

  // Carte des observations (schéma).
  map: { width: MAP_W, height: MAP_H, backgroundColor: '#f1f5f9', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 5, position: 'relative' },
  mapImage: { width: MAP_W, height: MAP_H, borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 5, objectFit: 'cover' },
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
      <MapLegend positions={positions} caption={`Emplacements relatifs des observations sur le chantier (${positions.length} point${positions.length > 1 ? 's' : ''}).`} />
    </View>
  )
}

// Légende (types présents) + caption — partagée par le schéma et l'instantané.
function MapLegend({ positions, caption }: { positions: VisitCrDoc['positions']; caption: string }) {
  const kindsPresent = [...new Set(positions.map((p) => p.kind))]
  return (
    <>
      <View style={styles.legend}>
        {kindsPresent.map((k) => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: KIND_COLOR[k] ?? '#6b7280' }]} />
            <Text style={styles.legendLabel}>{KIND_LABEL[k] ?? k}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </>
  )
}

// Instantané carte RÉEL (tuiles OSM assemblées côté serveur, fabriqué une fois et
// réutilisé). Rendu net dans la même boîte que le schéma ; même légende.
function ObservationMapSnapshot({ src, positions }: { src: string; positions: VisitCrDoc['positions'] }) {
  return (
    <View wrap={false}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
      <Image src={src} style={styles.mapImage} />
      <MapLegend positions={positions} caption={`Emplacements des observations sur le chantier (${positions.length} point${positions.length > 1 ? 's' : ''}).`} />
    </View>
  )
}

export function VisitCrPdf({ doc, debrief, exportDate, mapImage }: { doc: VisitCrDoc; debrief?: StoredDebriefAnalysis | null; exportDate: string; mapImage?: string | null }) {
  // L'INTENTION spécialise le TITRE et quelques intitulés — mêmes données, cadrage
  // différent (première = référence · prévisite = appel d'offres · suivi = normal).
  const isPremiere = doc.motive === 'premiere'
  const isAo = doc.motive === 'previsite_ao'
  const kicker = isPremiere ? 'État initial du chantier' : isAo ? "Prévisite d'appel d'offres" : 'Compte-rendu de visite de chantier'
  const reservesTitle = isPremiere ? 'Premières réserves' : isAo ? 'Points de vigilance observés' : 'Réserves'
  const actionsTitle = isPremiere ? 'Premières actions' : 'Actions à réaliser'
  const photosBase = isPremiere ? 'Photos de référence' : 'Photos clés'
  // Titre du DOCUMENT PDF : Chrome (Android surtout) l'affiche comme titre d'onglet
  // à l'ouverture « inline » — sans la DATE, toutes les visites d'un même chantier
  // portent le même titre et donnent l'impression d'ouvrir le même fichier.
  const title = `${kicker} — ${doc.siteName} · ${doc.dateLabel}`

  const reserveLines = [
    ...doc.reserves.map((r) => `${r.label}${r.location ? ` (${r.location})` : ''}`),
    ...doc.points.reserve,
  ]
  const actionLines = [
    ...doc.actions.map((a) => `${a.corps_etat ? `(${a.corps_etat}) ` : ''}${a.title}`),
    ...doc.points.action,
  ]

  // « Ce que MemorIA a retenu » — LE MÊME modèle que le mobile : le résultat de
  // l'analyse (narratif propre, actions proposées, points de vigilance), jamais
  // le verbatim. Repli déterministe si l'analyse n'est pas disponible.
  const summaryText = debrief?.summary?.trim() || doc.summary?.trim() || ''
  // Actions VIVANTES : le grand livre (hors écartées) est la source ; on montre
  // l'état « fait » (case cochée). Repli sur `actions` pour d'anciennes analyses.
  const proposedActions = debrief?.action_ledger
    ? debrief.action_ledger.filter((x) => x.state !== 'dismissed')
    : (debrief?.actions ?? []).map((a) => ({ ...a, state: 'open' as const }))
  const watchpoints = debrief?.watchpoints ?? []
  const decisions = debrief?.decisions ?? []
  const aSavoir = debrief?.a_savoir ?? []
  const echeances = debrief?.echeances ?? []
  const intervenants = debrief?.intervenants ?? []
  const PRIORITY_FR: Record<string, string> = { haute: 'Priorité haute', moyenne: 'Priorité moyenne', basse: 'Préparation' }

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

        {/* Ce que MemorIA a retenu — le RÉSULTAT de l'analyse, en premier. */}
        <View style={styles.section} wrap={false}>
          <SectionTitle text="Ce que MemorIA a retenu" color={COLORS.accent} important />
          <View style={styles.card}>
            <Text style={summaryText ? undefined : styles.empty}>
              {summaryText || 'Éléments insuffisants pour un résumé — voir les photos et l’annexe ci-dessous.'}
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

        {/* Actions proposées — un bloc DÉDIÉ, en cases à cocher (à faire), plus
            noyées dans le texte. Issues de l'analyse (propositions), jamais des
            actions déjà validées. */}
        {proposedActions.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Actions proposées" color="#7c3aed" />
            {proposedActions.map((a, i) => (
              <View key={i} style={styles.actionRow} wrap={false}>
                <View style={a.state === 'done' ? styles.checkboxDone : styles.checkbox} />
                <View style={styles.actionText}>
                  <Text style={a.state === 'done' ? styles.actionDone : undefined}>
                    {a.priority ? <Text style={styles.metaStrong}>{`[${PRIORITY_FR[a.priority] ?? a.priority}] `}</Text> : null}
                    {a.title}
                  </Text>
                  {a.rationale ? <Text style={styles.actionWhy}>{a.rationale}</Text> : null}
                  {(a.owner || a.due) ? (
                    <Text style={styles.actionWhy}>
                      {a.owner ? `Responsable : ${a.owner}` : ''}{a.owner && a.due ? ' · ' : ''}{a.due ? `Échéance : ${a.due}` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Points de vigilance — des FICHES exploitables (risque + impact +
            responsable + échéance), pas des paragraphes. */}
        {watchpoints.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Points de vigilance" color="#d97706" />
            {watchpoints.map((p, i) => (
              <View key={i} style={styles.alertRow} wrap={false}>
                <View style={styles.alertDot} />
                <View style={styles.actionText}>
                  <Text><Text style={styles.metaStrong}>{p.label}</Text></Text>
                  {(p.impact || p.owner || p.due) ? (
                    <Text style={styles.actionWhy}>
                      {p.impact}
                      {p.owner ? `${p.impact ? ' · ' : ''}Responsable : ${p.owner}` : ''}
                      {p.due ? `${p.impact || p.owner ? ' · ' : ''}Échéance : ${p.due}` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Décisions prises — les ENGAGEMENTS actés (ni action, ni risque). */}
        {decisions.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Décisions prises" color="#4f46e5" />
            {decisions.map((d, i) => (
              <View key={i} style={styles.checkRow} wrap={false}>
                <View style={styles.checkMark} />
                <Text style={styles.bulletText}>{d}</Text>
              </View>
            ))}
          </View>
        )}

        {/* À savoir — le contexte important mais non actionnable. */}
        {aSavoir.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="À savoir" color={COLORS.muted} />
            <Bullets items={aSavoir} />
          </View>
        )}

        {/* Échéances — les délais isolés. */}
        {echeances.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Échéances" color="#e11d48" />
            {/* Le document de preuve dit ce qui a été DIT : une date si elle a été
                donnée, la contrainte sinon. Jamais une date déduite d'un délai. */}
            <Bullets items={echeances.map((e) => echeanceLine(e))} />
          </View>
        )}

        {/* Intervenants — personnes/entreprises citées, réutilisables. */}
        {intervenants.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Intervenants" color={COLORS.slate} />
            <Bullets items={intervenants} />
          </View>
        )}

        {reserveLines.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text={reservesTitle} color="#e11d48" />
            <Bullets items={reserveLines} />
          </View>
        )}

        {/* Localisation — le « où » AVANT les preuves. Uniquement si des GPS existent. */}
        {doc.positions.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Localisation des observations" color="#0284c7" />
            {mapImage
              ? <ObservationMapSnapshot src={mapImage} positions={doc.positions} />
              : <ObservationMap positions={doc.positions} />}
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

        {/* Évolution — même point de vue : la preuve de la TRANSFORMATION, dans
            le document (le client n'a pas besoin d'ouvrir MemorIA). Des chapitres
            (≤3 séries × ≤4 jalons), jamais une galerie. */}
        {doc.evolutions.length > 0 && (
          <View style={styles.section}>
            <SectionTitle text="Évolution — même point de vue" color={COLORS.accent} important />
            {doc.evolutions.map((e, i) => (
              <View key={i} style={styles.evoBlock} wrap={false}>
                {e.label && <Text style={styles.evoLabel}>{e.label}</Text>}
                <View style={styles.evoRow}>
                  {e.items.map((p, j) => (
                    <View key={j} style={styles.evoCell}>
                      {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
                      <Image src={p.url} style={styles.evoPhoto} />
                      <Text style={styles.evoDate}>{p.dateLabel}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
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
