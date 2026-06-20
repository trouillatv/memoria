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
// Hauteur de ligne fixe du tableau intervenants : garantit l'alignement des
// cellules fusionnées (présence) et des sous-cellules (I/D) quel que soit le
// contenu (mono ou multi-personne). cellule fusionnée = N × IV_ROW_H.
const IV_ROW_H = 16

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
  page: { fontFamily: 'Helvetica', fontSize: 9, color: C.text, paddingTop: 78, paddingBottom: 60, paddingLeft: MARGIN, paddingRight: MARGIN, lineHeight: 1.28 },

  // Cadre de page (fixed, répété) — trait fin ARRONDI, sans fond. Le runaway
  // venait de la pastille (Text+render+bg), pas du borderRadius du cadre.
  pageFrame: { position: 'absolute', top: 12, left: 22, width: PAGE_W - 44, height: PAGE_H - 24, borderWidth: 0.75, borderColor: C.marine, borderRadius: 11 },

  // En-tête répété — largeur explicite, jamais left+right.
  header: { position: 'absolute', top: 16, left: MARGIN, width: CONTENT_W },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  logo: { width: 70, height: 'auto', objectFit: 'contain' },
  breadcrumb: { fontSize: 7.5, color: C.text, flex: 1, marginHorizontal: 8, marginTop: 4 },
  headRule: { borderBottomWidth: 1.5, borderBottomColor: C.marine, marginTop: 5 },

  // Logo / emplacement maître d'ouvrage (p.1, centré).
  clientWrap: { alignItems: 'center', marginBottom: 8, marginTop: 2 },
  clientLogo: { height: 54, width: 'auto', objectFit: 'contain' },
  clientPlaceholder: { paddingVertical: 4, alignItems: 'center' },
  clientPlaceholderCap: { fontSize: 7, color: C.greyText, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  clientPlaceholderName: { fontSize: 11, color: C.marine, fontFamily: 'Helvetica-Bold', marginTop: 1 },

  // Bloc-titre : FOND GRIS + bordure navy, coins DROITS (borderRadius 0).
  titleBox: { backgroundColor: '#dcdce2', borderWidth: 1.5, borderColor: C.marine, borderRadius: 0, padding: 8, marginBottom: 6 },
  titleTxt: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.marine, textAlign: 'center' },
  subTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center', textDecoration: 'underline', marginBottom: 8 },

  // Bandeau niveau 1 (marine) + filet rouge dessous + marqueur 4 points.
  // paddingLeft généreux pour que les points soient NETTEMENT dans le cadre.
  band1: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.marine, paddingVertical: 4.5, paddingLeft: 9, paddingRight: 6 },
  band1Rule: { height: 1.4, backgroundColor: C.red, marginBottom: 4 },
  // Chiffre et titre : MÊME police, taille, lineHeight, letterSpacing → alignés
  // sur la même ligne, centrés ensemble (le chiffre ne « flotte » plus).
  band1Num: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 10.5, lineHeight: 1, letterSpacing: 0.5, marginRight: 6 },
  band1Txt: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 10.5, lineHeight: 1, letterSpacing: 0.5, flex: 1 },
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

  // Intervenants — grille. Présence (I/P/AE/AN) FUSIONNÉE verticalement au
  // niveau organisme (cellule haute, centrée) ; D (diffusion) par personne.
  // GRILLE UNIFORME : conteneur tCont (borderTop+Left), chaque cellule = une
  // <View> avec borderRight+borderBottom IDENTIQUES → grille complète, aucune
  // demi-bordure, aucun trait fantôme. AUCUNE fusion.
  ivRow: { flexDirection: 'row' },
  ivHeadRowH: { height: 14 },
  ivDataRowH: { height: IV_ROW_H },
  ivc: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.grid, justifyContent: 'center', paddingHorizontal: 3 },
  ivcC: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.grid, justifyContent: 'center', alignItems: 'center' },
  ivHeadBg: { backgroundColor: '#e6e6ee' },
  // largeurs de colonnes (en-tête ET données → alignement garanti)
  ivwOrg: { width: 84 },
  ivwRep: { flex: 1 },
  ivwTel: { width: 40 },
  ivwMob: { width: 40 },
  ivwMail: { width: 100 },
  ivwP: { width: 15 },
  // styles de texte des cellules
  ivtHead: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.marine },
  ivtHeadC: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.marine, textAlign: 'center' },
  ivtOrg: { fontSize: 6.5, fontFamily: 'Helvetica-Bold' },
  ivtRep: { fontSize: 8 },
  ivtSm: { fontSize: 7 },
  ivtMail: { fontSize: 5.3, color: '#0563C1' },
  ivtX: { fontSize: 8 },
  ivBandCell: { flex: 1, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.grid, backgroundColor: '#eef1f8', justifyContent: 'center', paddingVertical: 2, paddingHorizontal: 4 },
  ivtBand: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.marine },
  ivLegend: { fontSize: 6.5, color: C.faint, fontStyle: 'italic', marginBottom: 2, marginTop: 2 },

  // Avancement — sous-titres niveau 3 : petites capitales SOULIGNÉES (original).
  subLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.marine, textDecoration: 'underline', marginTop: 4, marginBottom: 1 },

  // Planning détaillé bordé — matrice verticale. Bande de catégorie LÉGÈRE :
  // texte coloré sur fond teinté discret (pas un aplat plein façon bandeau).
  planBand: { flex: 1, backgroundColor: '#eef1f8', fontFamily: 'Helvetica-Bold', fontSize: 8.5, letterSpacing: 0.3 },
  planFieldL: { flex: 1, fontSize: 8 },
  planFieldV: { width: 120, fontSize: 8, fontFamily: 'Helvetica-Bold' },

  // Encadré prochaine réunion (interne DROIT — borderRadius 0 explicite).
  nextBox: { borderWidth: 1.5, borderColor: C.marine, borderRadius: 0, padding: 8, marginTop: 12, alignItems: 'center' },
  nextTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.marine, letterSpacing: 0.5, textDecoration: 'underline' },
  signature: { textAlign: 'right', fontFamily: 'Helvetica-Bold', marginTop: 10 },

  nota: { fontSize: 7.5, fontStyle: 'italic', color: C.greyText, marginTop: 2 },
  empty: { fontSize: 8, color: C.faint, fontStyle: 'italic' },

  // Pied de page (fixed) — cartouche DNS pleine largeur AVEC libellés (le seul
  // cartouche du document ; supprimé du haut). Numéro de page en texte simple.
  // HAUTEUR EXPLICITE obligatoire : le footer contient un Text `render` (n° de
  // page, contenu différé) ; sans hauteur fixe, Yoga ne peut pas mesurer un
  // élément ancré en bas → le pied s'effondre et disparaît (régression iter-9).
  footer: { position: 'absolute', bottom: 14, left: MARGIN, width: CONTENT_W },
  fcCont: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: C.grid },
  fcRow: { flexDirection: 'row' },
  fcCell: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.grid, paddingVertical: 1, paddingHorizontal: 3, fontSize: 6.5 },
  fcLabel: { borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: C.grid, paddingVertical: 1, paddingHorizontal: 3, fontSize: 5.5, fontFamily: 'Helvetica-Bold', color: C.marine, backgroundColor: '#f0f2f5' },
  fcDns: { flex: 1 },
  fcVer: { width: 54 },
  fcMod: { width: 104 },
  fcDate: { width: 78 },
  // Ligne haute du pied : fil d'Ariane (le n° de page se superpose à droite).
  footTopRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 },
  footTxt: { fontSize: 6.5, fontStyle: 'italic', color: C.faint, flex: 1 },
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
      <Text style={s.chevron}>{'>'}</Text>
      <Text style={s.pointTxt}>
        <EmphRuns text={texte} />
        {statut ? <Text style={s.statut}>  {statutLabel(statut)}</Text> : null}
      </Text>
    </View>
  )
}

// Un bloc = sous-titre (en-tête) + une ligne PAR point : texte (gauche) | ACTION
// codes responsables du point (droite). L'ACTION est désormais MÉMORISÉE par point
// (mig 132) ; fallback sur l'action commune du bloc si le point n'en porte pas.
function Bloc({ bloc }: { bloc: CrBecibBloc }) {
  return (
    <View>
      {bloc.sousTitre ? (
        <View style={s.tRow} wrap={false}>
          <Text style={[s.tCell, s.blocLeft, s.sousTitre]}>{bloc.sousTitre}</Text>
          <View style={[s.tCell, s.blocAction]} />
        </View>
      ) : null}
      {bloc.points.map((p, i) => {
        const codes = p.action.length ? p.action : bloc.action
        return (
          <View key={i} style={s.tRow} wrap={false}>
            <View style={[s.tCell, s.blocLeft]}>
              <PointLine texte={p.texte} statut={p.statut} />
            </View>
            <View style={[s.tCell, s.blocAction]}>
              <Text style={s.blocActionTxt}>{actionLabel(codes)}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

// Tableau de points : en-tête (POINTS … | ACTION) gardé avec sa 1re ligne
// (wrap=false) → l'en-tête ne tombe jamais seul en bas de page.
function PointsTable({ title, blocs, marginTop }: { title: string; blocs: CrBecibBloc[]; marginTop?: number }) {
  return (
    <View style={[s.tCont, marginTop ? { marginTop } : {}]}>
      <View wrap={false}>
        <View style={s.tRow}>
          <Text style={[s.tCell, s.colHeadL]}>{title}</Text>
          <Text style={[s.tCell, s.colHeadR]}>ACTION</Text>
        </View>
        {blocs[0] ? <Bloc bloc={blocs[0]} /> : null}
      </View>
      {blocs.slice(1).map((b, i) => <Bloc key={i} bloc={b} />)}
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

type Intervenant = CrBecib['intervenants'][number]

// Une ligne de données = 1 personne. CHAQUE cellule est une <View> bordée à
// l'identique (ivc / ivcC). Aucune fusion. Grille uniforme garantie.
function IvDataRow({ p }: { p: Intervenant }) {
  const X = ({ on }: { on: boolean }) => (
    <View style={[s.ivcC, s.ivwP]}><Text style={s.ivtX}>{on ? 'X' : ''}</Text></View>
  )
  return (
    <View style={[s.ivRow, s.ivDataRowH]} wrap={false}>
      <View style={[s.ivc, s.ivwOrg]}><Text style={s.ivtOrg}>{p.organisme}</Text></View>
      <View style={[s.ivc, s.ivwRep]}><Text style={s.ivtRep}>{p.representant}</Text></View>
      <View style={[s.ivc, s.ivwTel]}><Text style={s.ivtSm}>{p.tel || ''}</Text></View>
      <View style={[s.ivc, s.ivwMob]}><Text style={s.ivtSm}>{p.mob || ''}</Text></View>
      <View style={[s.ivc, s.ivwMail]}><Text style={s.ivtMail}>{p.email || ''}</Text></View>
      <X on={p.invite} />
      <X on={p.presence === 'P'} />
      <X on={p.presence === 'AE'} />
      <X on={p.presence === 'AN'} />
      <X on={p.diffusion} />
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
      // Retard = 0 par défaut (« pas de retard » est une info, pas une absence).
      ['Retard prévisionnel (jours calendaires)', pl.retard.previsionnel || '0'],
      ['Retard effectif (jours calendaires)', pl.retard.effectif || '0'],
    ] },
  ]

  return (
    <Document title={`CR ${cr.meta.numeroCR} — ${cr.meta.chantier}`}>
      <Page size="A4" style={s.page}>
        {/* Cadre de page arrondi (répété, sans fond → ne se remplit pas) */}
        <View style={s.pageFrame} fixed />

        {/* En-tête répété : IDENTITÉ de l'org. Logo BECIB réservé à l'org BECIB ;
            les autres orgs portent leur nom en clair (trame partagée, identité propre). */}
        <View style={s.header} fixed>
          <View style={s.headRow}>
            {cr.meta.moe === 'BECIB' ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image
              <Image src={BECIB_LOGO_DATA_URL} style={s.logo} />
            ) : (
              <Text style={{ fontSize: 13, color: '#1F2A5A' }}>{cr.meta.moe}</Text>
            )}
          </View>
          <View style={s.headRule} />
        </View>

        {/* Logo / emplacement maître d'ouvrage (p.1) */}
        <View style={s.clientWrap}>
          {cr.meta.clientLogoDataUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image
            <Image src={cr.meta.clientLogoDataUrl} style={s.clientLogo} />
          ) : (
            // Sans asset logo : nom du MOA centré, SANS libellé (l'original
            // n'affiche que le logo client). Remplacé par l'image dès fourniture.
            <View style={s.clientPlaceholder}>
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
          Du {dLong}{cr.meta.semaine ? ` - semaine ${cr.meta.semaine}` : ''}
        </Text>

        {/* 1. INTERVENANTS */}
        <Band1 num="1" title="INTERVENANTS" first />
        <Text style={s.ivLegend}>(I : Invité · P : Présent · AE : Absent excusé · AN : Absent non excusé · D : diffusion)</Text>
        <View style={s.tCont}>
          {/* En-tête : chaque colonne = une <View> bordée (mêmes largeurs que les données). */}
          <View style={[s.ivRow, s.ivHeadRowH]}>
            <View style={[s.ivc, s.ivwOrg, s.ivHeadBg]}><Text style={s.ivtHead}>Organisme</Text></View>
            <View style={[s.ivc, s.ivwRep, s.ivHeadBg]}><Text style={s.ivtHead}>Représentant</Text></View>
            <View style={[s.ivc, s.ivwTel, s.ivHeadBg]}><Text style={s.ivtHeadC}>Tél.</Text></View>
            <View style={[s.ivc, s.ivwMob, s.ivHeadBg]}><Text style={s.ivtHeadC}>Mob.</Text></View>
            <View style={[s.ivc, s.ivwMail, s.ivHeadBg]}><Text style={s.ivtHeadC}>Fax / e-mail</Text></View>
            {PRES_COLS.map((c) => <View key={c} style={[s.ivcC, s.ivwP, s.ivHeadBg]}><Text style={s.ivtHeadC}>{c}</Text></View>)}
          </View>
          {groups.map((g) => {
            const rows = cr.intervenants.filter((i) => i.groupe === g)
            if (rows.length === 0) return null
            return (
              <React.Fragment key={g}>
                {/* Bande corps de métier : une cellule pleine largeur, bordée comme les autres. */}
                <View style={s.ivRow}><View style={s.ivBandCell}><Text style={s.ivtBand}>{GROUP_LABEL[g]}</Text></View></View>
                {rows.map((p, k) => <IvDataRow key={k} p={p} />)}
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

        {/* 4. POINTS EXAMINÉS — en-tête de sous-tableau gardé avec ses 1res lignes. */}
        <Band1 num="4" title="POINTS EXAMINÉS" />
        <PointsTable title="POINTS ADMINISTRATIFS" blocs={cr.pointsExamines.administratifs} />
        <PointsTable title="POINTS TECHNIQUES" blocs={cr.pointsExamines.techniques} marginTop={6} />

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
        {/* Une SEULE bande niveau 2 regroupe Intempéries/Aléas + Planning (original). */}
        <Text style={s.band2}>INTEMPÉRIES, ALÉAS, PLANNING</Text>
        {cr.intemperiesAleas.length > 0 && cr.intemperiesAleas.map((t, i) => <PointLine key={`i${i}`} texte={t} statut={null} />)}
        <Text style={s.subLabel}>PLANNING</Text>
        {/* Tableau d'un bloc : pas de saut de page au milieu (RETARD orphelin). */}
        <View style={s.tCont} wrap={false}>
          {planSections.map((sec) => (
            <View key={sec.label}>
              <View style={s.tRow}>
                <Text style={[s.tCell, s.planBand, { color: sec.color }]}>{sec.label}</Text>
              </View>
              {sec.rows.map(([label, val]) => (
                <View key={label} style={s.tRow}>
                  <Text style={[s.tCell, s.planFieldL]}>{label}</Text>
                  <Text style={[s.tCell, s.planFieldV, { color: sec.color }]}>{val || '—'}</Text>
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
            {cr.photosComment ? (
              <Text style={{ fontSize: 8, marginBottom: 4 }}>{cr.photosComment}</Text>
            ) : null}
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

        {/* Pied de page répété : fil d'Ariane italique AU-DESSUS, puis cartouche
            DNS pleine largeur AVEC libellés. */}
        <View style={s.footer} fixed>
          <View style={s.footTopRow}>
            <Text style={s.footTxt}>{breadcrumb}</Text>
          </View>
          <View style={s.fcCont}>
            <View style={s.fcRow}>
              <Text style={[s.fcLabel, s.fcDns]}>Numéro DNS</Text>
              <Text style={[s.fcLabel, s.fcVer]}>Version</Text>
              <Text style={[s.fcLabel, s.fcMod]}>Modification : ordre</Text>
              <Text style={[s.fcLabel, s.fcDate]}>Date</Text>
            </View>
            <View style={s.fcRow}>
              <Text style={[s.fcCell, s.fcDns]}>{cr.meta.dns || '—'}</Text>
              <Text style={[s.fcCell, s.fcVer]}>{cr.meta.version}</Text>
              <Text style={[s.fcCell, s.fcMod]}>{cr.meta.modification}</Text>
              <Text style={[s.fcCell, s.fcDate]}>{dNum}</Text>
            </View>
          </View>
        </View>
        {/* Numéro de page : top-level `fixed` (le SEUL qui injecte pageNumber par
            page de façon fiable), positionné sur la ligne du fil d'Ariane du
            pied (bottom 36), à droite, dans le cadre → visible. */}
      </Page>
    </Document>
  )
}
