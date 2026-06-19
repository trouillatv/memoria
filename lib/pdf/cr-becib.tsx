// Gabarit BECIB — CR de réunion de chantier (@react-pdf/renderer).
// Reproduit la charte du brief (docs/Becib/brief_CR_BECIB.md) : bandeaux marine
// + filet rouge, en-tête/pied répétés + cartouche DNS, logo, encadré titre,
// table intervenants avec présence I/P/AE/AN/D, points en 2 colonnes
// POINTS|ACTION avec action de BLOC (cellule fusionnée), planning à bandes,
// sécurité en chevrons, encadré prochaine réunion + signature, pastille de page.
//
// Rendu DEPUIS le JSON CrBecib (source de vérité). Couleurs = points de départ
// du brief, à affiner par comparaison page à page avec le PDF original.

import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { BECIB_LOGO_DATA_URL } from './becib-logo'
import {
  parseEmphasis, statutLabel, actionLabel, NOTA_48H,
  type CrBecib, type CrBecibBloc,
} from '@/lib/documents/cr-becib-schema'

const C = {
  marine: '#1F2A5A', red: '#E2001A', grey: '#D9D9D9', greyText: '#475569',
  text: '#0f172a', faint: '#94a3b8', border: '#cbd5e1',
  planMarche: '#111827', planIntemp: '#0070C0', planProl: '#00B050', planRetard: '#C00000',
}

// A4 = 595.28 × 841.89 pt. Largeur de contenu contrainte explicitement
// (left + width), car @react-pdf gère mal « left + right » simultanés → c'était
// la cause du débordement à droite (en-tête/titre/ACTION/signature tronqués +
// bande parasite).
const PAGE_W = 595.28
const MARGIN = 34
const CONTENT_W = PAGE_W - MARGIN * 2 // 527.28

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: C.text, paddingTop: 80, paddingBottom: 46, paddingLeft: MARGIN, paddingRight: MARGIN, lineHeight: 1.35 },

  // En-tête répété (fixed) — largeur explicite, jamais left+right.
  header: { position: 'absolute', top: 18, left: MARGIN, width: CONTENT_W },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 72, height: 'auto', objectFit: 'contain' },
  breadcrumb: { fontSize: 7.5, color: C.text, flex: 1, marginHorizontal: 8 },
  // Cartouche structuré (2 lignes), largeur bornée → plus de run-on ni de coupe.
  cartouche: { width: 165 },
  cartoucheLine: { fontSize: 6.5, color: C.greyText, textAlign: 'right' },
  headRule: { borderBottomWidth: 1.5, borderBottomColor: C.marine, marginTop: 4 },

  // Bloc-titre
  titleBox: { borderWidth: 1.5, borderColor: C.marine, borderRadius: 4, padding: 8, marginBottom: 6 },
  titleTxt: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.marine, textAlign: 'center' },
  subTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center', textDecoration: 'underline', marginBottom: 10 },

  // Bandeau niveau 1 (marine)
  band1: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.marine, paddingVertical: 3, paddingHorizontal: 6, marginTop: 10, marginBottom: 4 },
  band1Num: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 6 },
  band1Txt: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 10, letterSpacing: 0.5, flex: 1 },
  // Marqueur de section : ~4 points rouges empilés à l'extrême gauche du bandeau.
  band1Dots: { width: 4, marginRight: 6, justifyContent: 'center' },
  band1Dot: { width: 3, height: 3, backgroundColor: C.red, marginBottom: 1.5 },

  // Sous-titre interne
  sousTitre: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.marine, textDecoration: 'underline', marginTop: 5, marginBottom: 2 },

  // Colonnes POINTS | ACTION
  colHead: { flexDirection: 'row', backgroundColor: C.grey, paddingVertical: 2, paddingHorizontal: 4, marginTop: 6 },
  colHeadL: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  colHeadR: { width: 64, fontFamily: 'Helvetica-Bold', fontSize: 8, textAlign: 'center', paddingLeft: 4 },
  blocRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.border, paddingVertical: 2 },
  blocLeft: { flex: 1, paddingRight: 6 },
  blocAction: { width: 64, textAlign: 'center', color: C.greyText, fontSize: 8.5, fontFamily: 'Helvetica-Bold', borderLeftWidth: 0.5, borderLeftColor: C.border, paddingLeft: 4 },
  pointLine: { flexDirection: 'row', marginBottom: 1 },
  chevron: { width: 9, color: C.marine },
  pointTxt: { flex: 1 },
  statut: { fontFamily: 'Helvetica-Bold', color: C.text },

  // Intervenants
  ivGroup: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.marine, backgroundColor: '#eef1f8', paddingVertical: 1.5, paddingHorizontal: 4, marginTop: 3 },
  ivRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.border, paddingVertical: 1.5, alignItems: 'center' },
  ivName: { flex: 1, fontSize: 8 },
  ivContact: { width: 120, fontSize: 7, color: C.greyText },
  ivP: { width: 14, fontSize: 8, textAlign: 'center', borderLeftWidth: 0.5, borderLeftColor: C.border },
  ivHeadRow: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 0.5, borderBottomColor: C.marine, marginTop: 2 },
  ivHeadSpacer: { flex: 1, fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.marine },
  ivHeadContact: { width: 120 },
  ivHeadP: { width: 14, fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center', color: C.marine, borderLeftWidth: 0.5, borderLeftColor: C.border },
  ivLegend: { fontSize: 6.5, color: C.faint, fontStyle: 'italic', marginBottom: 2 },

  // Avancement
  subLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.marine, marginTop: 4 },

  // Planning
  planRow: { flexDirection: 'row', marginBottom: 2 },
  planTag: { width: 90, color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7.5, paddingVertical: 2, paddingHorizontal: 4 },
  planVal: { flex: 1, fontSize: 8, paddingLeft: 6, paddingTop: 2 },

  // Encadré prochaine réunion
  nextBox: { borderWidth: 1.5, borderColor: C.marine, borderRadius: 4, padding: 8, marginTop: 12, alignItems: 'center' },
  nextTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.marine, letterSpacing: 0.5 },
  signature: { textAlign: 'right', fontFamily: 'Helvetica-Bold', marginTop: 10 },

  nota: { fontSize: 7.5, fontStyle: 'italic', color: C.greyText, marginTop: 2 },
  empty: { fontSize: 8, color: C.faint, fontStyle: 'italic' },

  // Cadre de page fin (fixed, répété) — trait uniforme, SANS borderRadius ni fond
  // (un border-only ne se remplit pas ; le borderRadius sur grande boîte rebugge).
  pageFrame: { position: 'absolute', top: 12, left: 22, width: PAGE_W - 44, height: 841.89 - 24, borderWidth: 0.75, borderColor: C.marine },
  // Pied de page (fixed) — largeur explicite, jamais left+right.
  footer: { position: 'absolute', bottom: 16, left: MARGIN, width: CONTENT_W, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 4 },
  footTxt: { fontSize: 6.5, fontStyle: 'italic', color: C.faint, flex: 1 },
  // Pastille de page : le FOND va sur la View (taille bornée), le numéro sur le
  // Text. NE JAMAIS mettre render + backgroundColor sur le même Text (le fond se
  // peint alors sur toute la hauteur → bande navy parasite à droite).
  pagePillBox: { backgroundColor: C.marine, borderRadius: 9, paddingVertical: 2, paddingHorizontal: 6 },
  pagePill: { color: '#fff', fontSize: 7, fontFamily: 'Helvetica-Bold' },
})

function EmphText({ text }: { text: string }) {
  return (
    <Text>
      {parseEmphasis(text).map((r, i) => (
        <Text key={i} style={r.bold ? { fontFamily: 'Helvetica-Bold' } : undefined}>{r.text}</Text>
      ))}
    </Text>
  )
}

function PointLine({ texte, statut }: { texte: string; statut: CrBecib['pointsExamines']['techniques'][number]['points'][number]['statut'] }) {
  return (
    <View style={s.pointLine} wrap={false}>
      <Text style={s.chevron}>›</Text>
      <Text style={s.pointTxt}>
        {parseEmphasis(texte).map((r, i) => (
          <Text key={i} style={r.bold ? { fontFamily: 'Helvetica-Bold' } : undefined}>{r.text}</Text>
        ))}
        {statut ? <Text style={s.statut}>  {statutLabel(statut)}</Text> : null}
      </Text>
    </View>
  )
}

// Un bloc = sous-titre + points (gauche) ; action du bloc (droite, cellule fusionnée).
function Bloc({ bloc }: { bloc: CrBecibBloc }) {
  return (
    <View style={s.blocRow} wrap={false}>
      <View style={s.blocLeft}>
        {bloc.sousTitre ? <Text style={s.sousTitre}>{bloc.sousTitre}</Text> : null}
        {bloc.points.map((p, i) => (
          <PointLine key={i} texte={p.texte} statut={p.statut} />
        ))}
      </View>
      <Text style={s.blocAction}>{actionLabel(bloc.action)}</Text>
    </View>
  )
}

function Band1({ num, title }: { num?: string; title: string }) {
  return (
    <View style={s.band1} wrap={false}>
      <View style={s.band1Dots}>
        <View style={s.band1Dot} /><View style={s.band1Dot} /><View style={s.band1Dot} /><View style={s.band1Dot} />
      </View>
      {num ? <Text style={s.band1Num}>{num}</Text> : null}
      <Text style={s.band1Txt}>{title}</Text>
    </View>
  )
}

const GROUP_LABEL: Record<string, string> = {
  MOA: "MAÎTRISE D'OUVRAGE", MOE: "MAÎTRISE D'ŒUVRE", ENTREPRISE: 'ENTREPRISE TITULAIRE', PARTENAIRES: 'PARTENAIRES',
}
const PRES_COLS = ['I', 'P', 'AE', 'AN', 'D'] as const

export function CrBecibPdf({ cr }: { cr: CrBecib }) {
  const dateFr = cr.meta.dateIso ? new Date(cr.meta.dateIso).toLocaleDateString('fr-FR') : ''
  const breadcrumb = `${cr.meta.moa} / ${cr.meta.moe} / ${cr.meta.chantier} / CR réunion de chantier`
  const cartouche = [cr.meta.dns, `Version ${cr.meta.version}`, `Modif. ${cr.meta.modification}`, dateFr].filter(Boolean).join('  |  ')
  const groups = ['MOA', 'MOE', 'ENTREPRISE', 'PARTENAIRES'] as const

  return (
    <Document title={`CR ${cr.meta.numeroCR} — ${cr.meta.chantier}`}>
      <Page size="A4" style={s.page}>
        {/* Cadre de page (trait fin, répété, sans fond ni borderRadius → ne se remplit pas) */}
        <View style={s.pageFrame} fixed />
        {/* En-tête répété */}
        <View style={s.header} fixed>
          <View style={s.headRow}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
            <Image src={BECIB_LOGO_DATA_URL} style={s.logo} />
            <Text style={s.breadcrumb}>{breadcrumb}</Text>
            <View style={s.cartouche}>
              <Text style={s.cartoucheLine}>N° DNS : {cr.meta.dns || '—'}</Text>
              <Text style={s.cartoucheLine}>Version {cr.meta.version} · Modif. {cr.meta.modification} · {dateFr}</Text>
            </View>
          </View>
          <View style={s.headRule} />
        </View>

        {/* Bloc-titre */}
        <View style={s.titleBox} wrap={false}>
          <Text style={s.titleTxt}>{cr.meta.projetTitre}</Text>
        </View>
        <Text style={s.subTitle}>
          COMPTE-RENDU N°{cr.meta.numeroCR} DE LA RÉUNION DE CHANTIER{'\n'}
          Du {dateFr}{cr.meta.semaine ? ` — semaine ${cr.meta.semaine}` : ''}
        </Text>

        {/* 1. INTERVENANTS */}
        <Band1 num="1" title="INTERVENANTS" />
        <Text style={s.ivLegend}>(I : Invité · P : Présent · AE : Absent excusé · AN : Absent non excusé · D : diffusion)</Text>
        <View style={s.ivHeadRow}>
          <Text style={s.ivHeadSpacer}>Représentant</Text>
          <Text style={s.ivHeadContact}> </Text>
          {PRES_COLS.map((c) => <Text key={c} style={s.ivHeadP}>{c}</Text>)}
        </View>
        {groups.map((g) => {
          const rows = cr.intervenants.filter((i) => i.groupe === g)
          if (rows.length === 0) return null
          return (
            <View key={g} wrap={false}>
              <Text style={s.ivGroup}>{GROUP_LABEL[g]}</Text>
              {rows.map((i, k) => (
                <View key={k} style={s.ivRow}>
                  <Text style={s.ivName}>{i.representant}</Text>
                  <Text style={s.ivContact}>{[i.tel, i.mob, i.email].filter(Boolean).join(' · ')}</Text>
                  {PRES_COLS.map((c) => <Text key={c} style={s.ivP}>{i.presence === c ? 'X' : ''}</Text>)}
                </View>
              ))}
            </View>
          )
        })}

        {/* 2. ORDRE DU JOUR */}
        <Band1 num="2" title="ORDRE DU JOUR" />
        {cr.ordreDuJour.length > 0
          ? cr.ordreDuJour.map((o, i) => <PointLine key={i} texte={o} statut={null} />)
          : <Text style={s.empty}>—</Text>}

        {/* 3. REMARQUES SUR CR PRÉCÉDENT */}
        <Band1 num="3" title="REMARQUES SUR CR PRÉCÉDENT" />
        <EmphText text={cr.remarquesCrPrecedent || 'RAS.'} />
        <Text style={s.nota}>{NOTA_48H}</Text>

        {/* 4. POINTS EXAMINÉS */}
        <Band1 num="4" title="POINTS EXAMINÉS" />
        <View style={s.colHead}><Text style={s.colHeadL}>POINTS ADMINISTRATIFS</Text><Text style={s.colHeadR}>ACTION</Text></View>
        {cr.pointsExamines.administratifs.map((b, i) => <Bloc key={i} bloc={b} />)}
        <View style={s.colHead}><Text style={s.colHeadL}>POINTS TECHNIQUES</Text><Text style={s.colHeadR}>ACTION</Text></View>
        {cr.pointsExamines.techniques.map((b, i) => <Bloc key={i} bloc={b} />)}

        {/* 5. AVANCEMENT, PLANNING */}
        <Band1 num="5" title="AVANCEMENT, PLANNING" />
        {(cr.avancement.fait.length > 0 || cr.avancement.previsions.length > 0) && (
          <>
            {cr.avancement.fait.length > 0 && <Text style={s.subLabel}>FAIT</Text>}
            {cr.avancement.fait.map((t, i) => <PointLine key={`f${i}`} texte={t} statut={null} />)}
            {cr.avancement.previsions.length > 0 && <Text style={s.subLabel}>PRÉVISIONS</Text>}
            {cr.avancement.previsions.map((t, i) => <PointLine key={`p${i}`} texte={t} statut={null} />)}
          </>
        )}
        {cr.intemperiesAleas.length > 0 && (
          <>
            <Text style={s.subLabel}>INTEMPÉRIES / ALÉAS</Text>
            {cr.intemperiesAleas.map((t, i) => <PointLine key={`i${i}`} texte={t} statut={null} />)}
          </>
        )}
        <Text style={s.subLabel}>PLANNING</Text>
        <View style={s.planRow}><Text style={[s.planTag, { backgroundColor: C.planMarche }]}>MARCHÉ</Text><Text style={s.planVal}>{[cr.planning.marche.osDemarrage && `OS ${cr.planning.marche.osDemarrage}`, cr.planning.marche.delai, cr.planning.marche.finContractuelle && `fin ${cr.planning.marche.finContractuelle}`].filter(Boolean).join(' · ') || '—'}</Text></View>
        <View style={s.planRow}><Text style={[s.planTag, { backgroundColor: C.planIntemp }]}>INTEMPÉRIES</Text><Text style={s.planVal}>{[cr.planning.intemperies.depuisDerniereReunion, cr.planning.intemperies.cumulOuvrable && `cumul ${cr.planning.intemperies.cumulOuvrable}`, cr.planning.intemperies.finAvecIntemperies && `fin ${cr.planning.intemperies.finAvecIntemperies}`].filter(Boolean).join(' · ') || '—'}</Text></View>
        <View style={s.planRow}><Text style={[s.planTag, { backgroundColor: C.planProl }]}>PROLONGATIONS</Text><Text style={s.planVal}>{cr.planning.prolongations || '—'}</Text></View>
        <View style={s.planRow}><Text style={[s.planTag, { backgroundColor: C.planRetard }]}>RETARD</Text><Text style={s.planVal}>{[cr.planning.retard.previsionnel && `prév. ${cr.planning.retard.previsionnel}`, cr.planning.retard.effectif && `effectif ${cr.planning.retard.effectif}`].filter(Boolean).join(' · ') || '—'}</Text></View>

        {/* 6. SÉCURITÉ, ENVIRONNEMENT */}
        {cr.securite.length > 0 && (
          <>
            <Band1 num="6" title="SÉCURITÉ, ENVIRONNEMENT" />
            {cr.securite.map((t, i) => <PointLine key={i} texte={t} statut={null} />)}
          </>
        )}

        {/* 7. PHOTOS */}
        {cr.photos.length > 0 && (
          <>
            <Band1 num="7" title="PHOTOS" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {cr.photos.map((p, i) => (
                <View key={i} style={{ width: 150 }}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
                  <Image src={p.url} style={{ width: 150, height: 100, objectFit: 'cover', borderWidth: 0.5, borderColor: C.border }} />
                  <Text style={{ fontSize: 6.5, color: C.faint }}>{p.legende}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Prochaine réunion + signature — groupés (jamais d'orphelin en dernière page) */}
        <View wrap={false} minPresenceAhead={80}>
          <View style={s.nextBox}>
            <Text style={s.nextTitle}>PROCHAINE RÉUNION</Text>
            <Text style={{ fontSize: 9, marginTop: 2 }}>
              {[cr.prochaineReunion.date, cr.prochaineReunion.heure, cr.prochaineReunion.lieu].filter(Boolean).join(' · ') || 'À planifier.'}
            </Text>
          </View>
          <Text style={s.signature}>{cr.signature}</Text>
        </View>

        {/* Pied de page répété */}
        <View style={s.footer} fixed>
          <Text style={s.footTxt}>{breadcrumb}  —  {cartouche}</Text>
          <View style={s.pagePillBox}>
            <Text style={s.pagePill} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </View>
        </View>
      </Page>
    </Document>
  )
}
