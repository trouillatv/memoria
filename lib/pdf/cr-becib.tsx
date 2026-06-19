// Gabarit BECIB — CR de réunion de chantier (@react-pdf/renderer).
// Reproduit la charte du brief (docs/Becib/brief_CR_BECIB.md) : cadre de page
// arrondi, en-tête/pied répétés avec cartouche DNS en table bordée + logo, logo
// client centré (p.1), encadré titre, bandeaux marine + filet rouge + sous-
// bandeaux gris niveau 2, tableaux BORDÉS (intervenants en grille avec colonnes
// Tél/Mob/e-mail + présence I/P/AE/AN/D, points en 2 colonnes POINTS|ACTION,
// planning détaillé), sécurité en chevrons, encadré prochaine réunion +
// signature, pastille de page en cercle.
//
// Rendu DEPUIS le JSON CrBecib (source de vérité). Décisions éditoriales
// (Vincent 2026-06-20) : statuts en GRAS NOIR (pas de couleur), planning
// DÉTAILLÉ, accents conservés sur les capitales, dates en LETTRES dans le corps
// et NUMÉRIQUES dans les cartouches. Cadre arrondi, encadrés internes droits.

import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { BECIB_LOGO_DATA_URL } from './becib-logo'
import {
  parseEmphasis, statutLabel, actionLabel, NOTA_48H,
  type CrBecib, type CrBecibBloc,
} from '@/lib/documents/cr-becib-schema'

const C = {
  marine: '#1F2A5A', red: '#E2001A', grey: '#D9D9D9', greyText: '#475569',
  text: '#0f172a', faint: '#94a3b8', border: '#cbd5e1', grid: '#7a7a7a',
  planMarche: '#111827', planIntemp: '#0070C0', planProl: '#00B050', planRetard: '#C00000',
}

// A4 = 595.28 × 841.89 pt. Largeur de contenu contrainte explicitement
// (left + width), car @react-pdf gère mal « left + right » simultanés.
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 34
const CONTENT_W = PAGE_W - MARGIN * 2 // 527.28

// Mois FR sans dépendance ICU (Vercel) — date en lettres dans le corps.
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
function dateLong(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso || ''
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function dateNum(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso || ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: C.text, paddingTop: 78, paddingBottom: 40, paddingLeft: MARGIN, paddingRight: MARGIN, lineHeight: 1.28 },

  // Cadre de page (fixed, répété) — trait fin ARRONDI, sans fond. Le runaway
  // venait de la pastille (Text+render+bg), pas du borderRadius du cadre.
  pageFrame: { position: 'absolute', top: 12, left: 22, width: PAGE_W - 44, height: PAGE_H - 24, borderWidth: 0.75, borderColor: C.marine, borderRadius: 11 },

  // En-tête répété — largeur explicite, jamais left+right.
  header: { position: 'absolute', top: 16, left: MARGIN, width: CONTENT_W },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  logo: { width: 70, height: 'auto', objectFit: 'contain' },
  breadcrumb: { fontSize: 7.5, color: C.text, flex: 1, marginHorizontal: 8, marginTop: 4 },
  headRule: { borderBottomWidth: 1.5, borderBottomColor: C.marine, marginTop: 5 },

  // Cartouche DNS : table bordée 4 cases (p.1) ou rappel compact 1 ligne (p.2+).
  // Slot à hauteur EXPLICITE → le render par page ne peut pas partir en runaway.
  cartoucheSlot: { width: 178, height: 44 },
  cartouche: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: C.grid },
  cartoucheCell: { flexDirection: 'row', borderBottomWidth: 0.5, borderRightWidth: 0.5, borderColor: C.grid, paddingVertical: 1, paddingHorizontal: 3 },
  cartoucheLabel: { fontSize: 6, fontFamily: 'Helvetica-Bold', color: C.marine, width: 56 },
  cartoucheVal: { fontSize: 6.5, color: C.text, flex: 1 },
  cartoucheCompact: { flexDirection: 'row', borderWidth: 0.5, borderColor: C.grid },
  cartoucheCompactCell: { borderRightWidth: 0.5, borderColor: C.grid, paddingVertical: 1, paddingHorizontal: 3, fontSize: 6 },
  cartoucheCompactLast: { paddingVertical: 1, paddingHorizontal: 3, fontSize: 6 },

  // Logo / emplacement maître d'ouvrage (p.1, centré).
  clientWrap: { alignItems: 'center', marginBottom: 8 },
  clientLogo: { height: 46, width: 'auto', objectFit: 'contain' },
  clientPlaceholder: { borderWidth: 0.5, borderColor: C.faint, borderStyle: 'dashed', paddingVertical: 8, paddingHorizontal: 22, alignItems: 'center' },
  clientPlaceholderCap: { fontSize: 6, color: C.faint, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  clientPlaceholderName: { fontSize: 8, color: C.greyText, marginTop: 1 },

  // Bloc-titre (encadré interne DROIT).
  titleBox: { borderWidth: 1.5, borderColor: C.marine, padding: 8, marginBottom: 6 },
  titleTxt: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.marine, textAlign: 'center' },
  subTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center', textDecoration: 'underline', marginBottom: 8 },

  // Bandeau niveau 1 (marine) + filet rouge dessous + marqueur 4 points.
  // paddingLeft généreux pour que les points soient NETTEMENT dans le cadre.
  band1: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.marine, paddingVertical: 3, paddingLeft: 9, paddingRight: 6 },
  band1Rule: { height: 1.4, backgroundColor: C.red, marginBottom: 4 },
  band1Num: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 10, marginRight: 6 },
  band1Txt: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 10, letterSpacing: 0.5, flex: 1 },
  band1Dots: { width: 4, marginRight: 7, alignItems: 'center', justifyContent: 'center' },
  band1Dot: { width: 3, height: 3, backgroundColor: C.red, marginVertical: 0.75 },
  band1Top: { marginTop: 8 },

  // Bandeau niveau 2 (gris).
  band2: { backgroundColor: C.grey, paddingVertical: 2, paddingHorizontal: 6, marginTop: 6, marginBottom: 3, fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.text },

  // Sous-titre interne (dans les blocs points).
  sousTitre: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: C.marine, textDecoration: 'underline', marginTop: 3, marginBottom: 2 },

  // --- Grille de table générique (border top+left sur le conteneur, right+bottom sur les cellules → pas de double trait) ---
  tCont: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: C.grid, marginTop: 4 },
  tRow: { flexDirection: 'row' },
  tCell: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.grid, paddingVertical: 2, paddingHorizontal: 3 },

  // Points examinés
  colHeadL: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 8, backgroundColor: C.grey },
  colHeadR: { width: 70, fontFamily: 'Helvetica-Bold', fontSize: 8, textAlign: 'center', backgroundColor: C.grey },
  blocLeft: { flex: 1 },
  blocAction: { width: 70, justifyContent: 'center', alignItems: 'center' },
  blocActionTxt: { textAlign: 'center', color: C.text, fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  pointLine: { flexDirection: 'row', marginBottom: 1 },
  chevron: { width: 9, color: C.marine },
  pointTxt: { flex: 1 },
  statut: { fontFamily: 'Helvetica-Bold', color: C.text },

  // Intervenants — grille avec colonnes distinctes.
  ivGroup: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: C.marine, backgroundColor: '#eef1f8' },
  ivRep: { flex: 1, fontSize: 8 },
  ivTel: { width: 46, fontSize: 7 },
  ivMob: { width: 46, fontSize: 7 },
  ivMail: { width: 118, fontSize: 5.8, color: C.greyText },
  ivP: { width: 15, fontSize: 8, textAlign: 'center' },
  ivHeadTxt: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.marine, textAlign: 'center' },
  ivHeadRep: { flex: 1, fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.marine },
  ivLegend: { fontSize: 6.5, color: C.faint, fontStyle: 'italic', marginBottom: 2, marginTop: 2 },

  // Avancement
  subLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.marine, marginTop: 3 },

  // Planning détaillé bordé — matrice verticale (bande catégorie colorée, puis
  // lignes « Libellé | Valeur », une par champ).
  planBand: { flex: 1, color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 8, letterSpacing: 0.3 },
  planFieldL: { flex: 1, fontSize: 8 },
  planFieldV: { width: 120, fontSize: 8, fontFamily: 'Helvetica-Bold' },

  // Encadré prochaine réunion (interne DROIT).
  nextBox: { borderWidth: 1.5, borderColor: C.marine, padding: 8, marginTop: 12, alignItems: 'center' },
  nextTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.marine, letterSpacing: 0.5 },
  signature: { textAlign: 'right', fontFamily: 'Helvetica-Bold', marginTop: 10 },

  nota: { fontSize: 7.5, fontStyle: 'italic', color: C.greyText, marginTop: 2 },
  empty: { fontSize: 8, color: C.faint, fontStyle: 'italic' },

  // Pied de page (fixed) — cartouche bordé compact + pastille ronde.
  footer: { position: 'absolute', bottom: 16, left: MARGIN, width: CONTENT_W, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 4 },
  footTxt: { fontSize: 6.5, fontStyle: 'italic', color: C.faint, flex: 1, marginRight: 6 },
  footCartouche: { flexDirection: 'row', borderWidth: 0.5, borderColor: C.grid, marginRight: 8 },
  footCell: { borderRightWidth: 0.5, borderColor: C.grid, paddingVertical: 1, paddingHorizontal: 3, fontSize: 6 },
  footCellLast: { paddingVertical: 1, paddingHorizontal: 3, fontSize: 6 },
  // Pastille ronde : taille EXPLICITE (sinon Text+render → hauteur runaway).
  // Le Text porte AUSSI une largeur explicite, sinon le contenu différé (render)
  // lui donne une largeur 0 dans un parent centré → numéro invisible.
  pagePillBox: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.marine, alignItems: 'center', justifyContent: 'center' },
  pagePill: { width: 20, color: '#fff', fontSize: 6.5, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
})

function EmphRuns({ text }: { text: string }) {
  return (
    <>
      {parseEmphasis(text).map((r, i) => (
        <Text key={i} style={r.bold ? { fontFamily: 'Helvetica-Bold' } : undefined}>{r.text}</Text>
      ))}
    </>
  )
}

function EmphText({ text }: { text: string }) {
  return <Text><EmphRuns text={text} /></Text>
}

function PointLine({ texte, statut }: { texte: string; statut: CrBecib['pointsExamines']['techniques'][number]['points'][number]['statut'] }) {
  return (
    <View style={s.pointLine} wrap={false}>
      <Text style={s.chevron}>›</Text>
      <Text style={s.pointTxt}>
        <EmphRuns text={texte} />
        {statut ? <Text style={s.statut}>  {statutLabel(statut)}</Text> : null}
      </Text>
    </View>
  )
}

// Un bloc = sous-titre + points (gauche) ; action du bloc (droite, centrée vert.).
function Bloc({ bloc }: { bloc: CrBecibBloc }) {
  return (
    <View style={s.tRow} wrap={false}>
      <View style={[s.tCell, s.blocLeft]}>
        {bloc.sousTitre ? <Text style={s.sousTitre}>{bloc.sousTitre}</Text> : null}
        {bloc.points.map((p, i) => (
          <PointLine key={i} texte={p.texte} statut={p.statut} />
        ))}
      </View>
      <View style={[s.tCell, s.blocAction]}>
        <Text style={s.blocActionTxt}>{actionLabel(bloc.action)}</Text>
      </View>
    </View>
  )
}

function Band1({ num, title, first }: { num?: string; title: string; first?: boolean }) {
  return (
    // minPresenceAhead : un bandeau ne reste jamais seul en bas de page.
    <View wrap={false} minPresenceAhead={48} style={first ? undefined : s.band1Top}>
      <View style={s.band1}>
        <View style={s.band1Dots}>
          <View style={s.band1Dot} /><View style={s.band1Dot} /><View style={s.band1Dot} /><View style={s.band1Dot} />
        </View>
        {num ? <Text style={s.band1Num}>{num}</Text> : null}
        <Text style={s.band1Txt}>{title}</Text>
      </View>
      <View style={s.band1Rule} />
    </View>
  )
}

const GROUP_LABEL: Record<string, string> = {
  MOA: "MAÎTRISE D'OUVRAGE", MOE: "MAÎTRISE D'ŒUVRE", ENTREPRISE: 'ENTREPRISE TITULAIRE', PARTENAIRES: 'PARTENAIRES',
}
const PRES_COLS = ['I', 'P', 'AE', 'AN', 'D'] as const

// Cartouche DNS bordé complet (4 cases) — p.1.
function CartoucheFull({ dns, version, modification, date }: { dns: string; version: string; modification: string; date: string }) {
  const lines: [string, string][] = [
    ['N° DNS', dns || '—'],
    ['Version', version],
    ['Modification', modification],
    ['Date', date],
  ]
  return (
    <View style={s.cartouche}>
      {lines.map(([l, v]) => (
        <View key={l} style={s.cartoucheCell}>
          <Text style={s.cartoucheLabel}>{l}</Text>
          <Text style={s.cartoucheVal}>{v}</Text>
        </View>
      ))}
    </View>
  )
}

// Rappel compact 1 ligne — p.2+ (en-tête plus léger).
function CartoucheCompact({ dns, version, modification, date }: { dns: string; version: string; modification: string; date: string }) {
  return (
    <View style={s.cartoucheCompact}>
      <Text style={s.cartoucheCompactCell}>{dns || '—'}</Text>
      <Text style={s.cartoucheCompactCell}>V{version}</Text>
      <Text style={s.cartoucheCompactCell}>Mod. {modification}</Text>
      <Text style={s.cartoucheCompactLast}>{date}</Text>
    </View>
  )
}

export function CrBecibPdf({ cr }: { cr: CrBecib }) {
  const dLong = cr.meta.dateIso ? dateLong(cr.meta.dateIso) : ''
  const dNum = cr.meta.dateIso ? dateNum(cr.meta.dateIso) : ''
  const breadcrumb = `${cr.meta.moa} / ${cr.meta.moe} / ${cr.meta.chantier} / CR réunion de chantier`
  const groups = ['MOA', 'MOE', 'ENTREPRISE', 'PARTENAIRES'] as const
  const pl = cr.planning

  // Planning en matrice verticale : 4 catégories colorées, une ligne par champ
  // nommé (le schéma typé fournit chaque valeur ; vide → « — »).
  const planSections: { label: string; color: string; rows: [string, string | null][] }[] = [
    { label: 'MARCHÉ', color: C.planMarche, rows: [
      ['Début période de préparation (OS de démarrage)', pl.marche.osDemarrage],
      ['Délai contractuel', pl.marche.delai],
      ['Fin du délai contractuel', pl.marche.finContractuelle],
    ] },
    { label: 'INTEMPÉRIES', color: C.planIntemp, rows: [
      ['Intempéries depuis dernière réunion (jours)', pl.intemperies.depuisDerniereReunion],
      ['Cumul intempéries (jours ouvrables)', pl.intemperies.cumulOuvrable],
      ['Fin du délai avec intempéries', pl.intemperies.finAvecIntemperies],
    ] },
    { label: 'PROLONGATIONS', color: C.planProl, rows: [
      ['Prolongations', pl.prolongations],
      ['Fin du délai avec intempéries et prolongations', null],
    ] },
    { label: 'RETARD', color: C.planRetard, rows: [
      ['Retard prévisionnel (jours calendaires)', pl.retard.previsionnel],
      ['Retard effectif (jours calendaires)', pl.retard.effectif],
    ] },
  ]

  return (
    <Document title={`CR ${cr.meta.numeroCR} — ${cr.meta.chantier}`}>
      <Page size="A4" style={s.page}>
        {/* Cadre de page arrondi (répété, sans fond → ne se remplit pas) */}
        <View style={s.pageFrame} fixed />

        {/* En-tête répété */}
        <View style={s.header} fixed>
          <View style={s.headRow}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
            <Image src={BECIB_LOGO_DATA_URL} style={s.logo} />
            <Text style={s.breadcrumb}>{breadcrumb}</Text>
            {/* Slot à hauteur fixe → le render par page ne peut pas runaway.
                p.1 = cartouche complet ; p.2+ = rappel compact. */}
            <View
              style={s.cartoucheSlot}
              render={({ pageNumber }) =>
                pageNumber === 1
                  ? <CartoucheFull dns={cr.meta.dns || ''} version={cr.meta.version} modification={cr.meta.modification} date={dNum} />
                  : <CartoucheCompact dns={cr.meta.dns || ''} version={cr.meta.version} modification={cr.meta.modification} date={dNum} />
              }
            />
          </View>
          <View style={s.headRule} />
        </View>

        {/* Logo / emplacement maître d'ouvrage (p.1) */}
        <View style={s.clientWrap}>
          {cr.meta.clientLogoDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image
            <Image src={cr.meta.clientLogoDataUrl} style={s.clientLogo} />
          ) : (
            <View style={s.clientPlaceholder}>
              <Text style={s.clientPlaceholderCap}>MAÎTRISE D'OUVRAGE</Text>
              <Text style={s.clientPlaceholderName}>{cr.meta.moa || '—'}</Text>
            </View>
          )}
        </View>

        {/* Bloc-titre */}
        <View style={s.titleBox} wrap={false}>
          <Text style={s.titleTxt}>{cr.meta.projetTitre}</Text>
        </View>
        <Text style={s.subTitle}>
          COMPTE-RENDU N°{cr.meta.numeroCR} DE LA RÉUNION DE CHANTIER{'\n'}
          Du {dLong}{cr.meta.semaine ? ` — semaine ${cr.meta.semaine}` : ''}
        </Text>

        {/* 1. INTERVENANTS */}
        <Band1 num="1" title="INTERVENANTS" first />
        <Text style={s.ivLegend}>(I : Invité · P : Présent · AE : Absent excusé · AN : Absent non excusé · D : diffusion)</Text>
        <View style={s.tCont}>
          <View style={s.tRow}>
            <Text style={[s.tCell, s.ivHeadRep]}>Représentant</Text>
            <Text style={[s.tCell, s.ivTel, s.ivHeadTxt]}>Tél.</Text>
            <Text style={[s.tCell, s.ivMob, s.ivHeadTxt]}>Mob.</Text>
            <Text style={[s.tCell, s.ivMail, s.ivHeadTxt]}>Fax / e-mail</Text>
            {PRES_COLS.map((c) => <Text key={c} style={[s.tCell, s.ivP, s.ivHeadTxt]}>{c}</Text>)}
          </View>
          {groups.map((g) => {
            const rows = cr.intervenants.filter((i) => i.groupe === g)
            if (rows.length === 0) return null
            return (
              <React.Fragment key={g}>
                <View style={s.tRow}>
                  <Text style={[s.tCell, s.ivGroup, { flex: 1 }]}>{GROUP_LABEL[g]}</Text>
                </View>
                {rows.map((i, k) => (
                  <View key={k} style={s.tRow} wrap={false}>
                    <Text style={[s.tCell, s.ivRep]}>{i.representant}</Text>
                    <Text style={[s.tCell, s.ivTel]}>{i.tel || ''}</Text>
                    <Text style={[s.tCell, s.ivMob]}>{i.mob || ''}</Text>
                    <Text style={[s.tCell, s.ivMail]}>{i.email || ''}</Text>
                    {PRES_COLS.map((c) => <Text key={c} style={[s.tCell, s.ivP]}>{i.presence === c ? 'X' : ''}</Text>)}
                  </View>
                ))}
              </React.Fragment>
            )
          })}
        </View>

        {/* 2. ORDRE DU JOUR */}
        <Band1 num="2" title="ORDRE DU JOUR" />
        {cr.ordreDuJour.length > 0
          ? cr.ordreDuJour.map((o, i) => <PointLine key={i} texte={o} statut={null} />)
          : <Text style={s.empty}>—</Text>}

        {/* 3. REMARQUES SUR CR PRÉCÉDENT */}
        <Band1 num="3" title="REMARQUES SUR CR PRÉCÉDENT" />
        <EmphText text={cr.remarquesCrPrecedent || 'RAS.'} />
        <Text style={s.nota}>{NOTA_48H}</Text>

        {/* 4. POINTS EXAMINÉS — minPresenceAhead : l'en-tête de sous-tableau ne
            tombe jamais seul en bas de page (il part avec ses 1res lignes). */}
        <Band1 num="4" title="POINTS EXAMINÉS" />
        <View style={s.tCont} minPresenceAhead={56}>
          <View style={s.tRow}>
            <Text style={[s.tCell, s.colHeadL]}>POINTS ADMINISTRATIFS</Text>
            <Text style={[s.tCell, s.colHeadR]}>ACTION</Text>
          </View>
          {cr.pointsExamines.administratifs.map((b, i) => <Bloc key={i} bloc={b} />)}
        </View>
        <View style={[s.tCont, { marginTop: 6 }]} minPresenceAhead={56}>
          <View style={s.tRow}>
            <Text style={[s.tCell, s.colHeadL]}>POINTS TECHNIQUES</Text>
            <Text style={[s.tCell, s.colHeadR]}>ACTION</Text>
          </View>
          {cr.pointsExamines.techniques.map((b, i) => <Bloc key={i} bloc={b} />)}
        </View>

        {/* 5. AVANCEMENT, PLANNING */}
        <Band1 num="5" title="AVANCEMENT, PLANNING" />
        {(cr.avancement.fait.length > 0 || cr.avancement.previsions.length > 0) && (
          <>
            <Text style={s.band2}>AVANCEMENT</Text>
            {cr.avancement.fait.length > 0 && <Text style={s.subLabel}>FAIT</Text>}
            {cr.avancement.fait.map((t, i) => <PointLine key={`f${i}`} texte={t} statut={null} />)}
            {cr.avancement.previsions.length > 0 && <Text style={s.subLabel}>PRÉVISIONS</Text>}
            {cr.avancement.previsions.map((t, i) => <PointLine key={`p${i}`} texte={t} statut={null} />)}
          </>
        )}
        {cr.intemperiesAleas.length > 0 && (
          <>
            <Text style={s.band2}>INTEMPÉRIES, ALÉAS</Text>
            {cr.intemperiesAleas.map((t, i) => <PointLine key={`i${i}`} texte={t} statut={null} />)}
          </>
        )}
        <Text style={s.band2}>PLANNING</Text>
        <View style={s.tCont}>
          {planSections.map((sec) => (
            <View key={sec.label} wrap={false}>
              <View style={s.tRow}>
                <Text style={[s.tCell, s.planBand, { backgroundColor: sec.color }]}>{sec.label}</Text>
              </View>
              {sec.rows.map(([label, val]) => (
                <View key={label} style={s.tRow}>
                  <Text style={[s.tCell, s.planFieldL]}>{label}</Text>
                  <Text style={[s.tCell, s.planFieldV]}>{val || '—'}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

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
                <View key={i} style={{ width: 150 }} wrap={false}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
                  <Image src={p.url} style={{ width: 150, height: 100, objectFit: 'cover', borderWidth: 0.5, borderColor: C.border }} />
                  <Text style={{ fontSize: 6.5, color: C.faint, textAlign: 'center', fontFamily: 'Helvetica-Bold', marginTop: 1 }}>{p.legende}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Prochaine réunion + signature — bloc insécable, sans minPresenceAhead
            (qui poussait tout en page orpheline). */}
        <View wrap={false}>
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
          <Text style={s.footTxt}>{breadcrumb}</Text>
          <View style={s.footCartouche}>
            <Text style={s.footCell}>{cr.meta.dns || '—'}</Text>
            <Text style={s.footCell}>V{cr.meta.version}</Text>
            <Text style={s.footCell}>Mod. {cr.meta.modification}</Text>
            <Text style={s.footCellLast}>{dNum}</Text>
          </View>
          <View style={s.pagePillBox}>
            <Text style={s.pagePill} render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`} />
          </View>
        </View>
      </Page>
    </Document>
  )
}
