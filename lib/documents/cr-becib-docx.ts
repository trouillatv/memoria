// Export Word ÉDITABLE du CR BECIB, depuis le MÊME JSON CrBecib que le PDF
// (source unique → deux sorties). Structure simple (tables + paragraphes) qui
// s'édite naturellement dans Word. Numérotation de page = champ NATIF Word.

import {
  Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, PageNumber, Footer, Header, ImageRun, VerticalAlign,
  TabStopType, TabStopPosition, PageBorderDisplay, PageBorderOffsetFrom,
} from 'docx'
import type { CrBecib, CrBecibBloc } from './cr-becib-schema'
import { NOTA_48H, statutLabel, actionLabel } from './cr-becib-schema'
import { BECIB_LOGO_DATA_URL } from '@/lib/pdf/becib-logo'

// Logo BECIB (base64 → buffer + dimensions natives lues dans l'en-tête PNG).
const LOGO_BUF = Buffer.from(BECIB_LOGO_DATA_URL.split(',')[1] || '', 'base64')
const LOGO_W = LOGO_BUF.length > 24 ? LOGO_BUF.readUInt32BE(16) : 200
const LOGO_H = LOGO_BUF.length > 24 ? LOGO_BUF.readUInt32BE(20) : 80

const C = {
  marine: '1F2A5A', red: 'E2001A', headGrey: 'E6E6EE', band2Grey: 'D9D9D9', orgBlue: 'EEF1F8',
  greyText: '475569', blue: '0563C1', text: '111827',
  planMarche: '111827', planIntemp: '0070C0', planProl: '00B050', planRetard: 'C00000',
}
const GROUP_LABEL: Record<string, string> = {
  MOA: "MAÎTRISE D'OUVRAGE", MOE: "MAÎTRISE D'ŒUVRE", ENTREPRISE: 'ENTREPRISE TITULAIRE', PARTENAIRES: 'PARTENAIRES',
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
function dateLong(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso || ''
  return `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function dateNum(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso || ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

const thin = { style: BorderStyle.SINGLE, size: 4, color: '7A7A7A' }
const cellBorders = { top: thin, bottom: thin, left: thin, right: thin }
const noSpace = { spacing: { before: 0, after: 0 } }

// --- briques ---
function band1(num: string, title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 0 },
    shading: { type: ShadingType.SOLID, color: C.marine, fill: C.marine },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: C.red } },
    children: [
      new TextRun({ text: `${num}  `, bold: true, color: 'FFFFFF', size: 22 }),
      new TextRun({ text: title, bold: true, color: 'FFFFFF', size: 21 }),
    ],
  })
}
function band2(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 40 },
    shading: { type: ShadingType.SOLID, color: C.band2Grey, fill: C.band2Grey },
    children: [new TextRun({ text: title, bold: true, color: C.text, size: 18 })],
  })
}
function subLabel(t: string): Paragraph {
  return new Paragraph({ spacing: { before: 80, after: 0 }, children: [new TextRun({ text: t, bold: true, underline: {}, color: C.marine, size: 16 })] })
}
function chevron(t: string, statut?: string | null): Paragraph {
  const runs = [new TextRun({ text: '> ', color: C.marine, size: 18 }), new TextRun({ text: t, size: 18 })]
  if (statut) runs.push(new TextRun({ text: `  ${statutLabel(statut as never)}`, bold: true, size: 18 }))
  return new Paragraph({ spacing: { before: 10, after: 10 }, children: runs })
}
function p(text: string, opts: { size?: number; bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; underline?: boolean } = {}): Paragraph {
  return new Paragraph({
    ...noSpace, alignment: opts.align,
    children: [new TextRun({ text, size: opts.size ?? 16, bold: opts.bold, color: opts.color, underline: opts.underline ? {} : undefined })],
  })
}
function txtCell(text: string, opts: { pct: number; size?: number; bold?: boolean; color?: string; center?: boolean; fill?: string } = { pct: 10 }): TableCell {
  return new TableCell({
    width: { size: opts.pct, type: WidthType.PERCENTAGE }, borders: cellBorders, verticalAlign: VerticalAlign.CENTER,
    shading: opts.fill ? { type: ShadingType.SOLID, color: opts.fill, fill: opts.fill } : undefined,
    children: [p(text, { size: opts.size, bold: opts.bold, color: opts.color, align: opts.center ? AlignmentType.CENTER : undefined })],
  })
}

// --- tableau intervenants (grille plate, 1 ligne/personne) ---
function intervenantsTable(cr: CrBecib): Table {
  const head = new TableRow({
    tableHeader: true,
    children: [
      txtCell('Organisme', { pct: 13, size: 14, bold: true, color: C.marine, fill: C.headGrey }),
      txtCell('Représentant', { pct: 17, size: 14, bold: true, color: C.marine, fill: C.headGrey }),
      txtCell('Tél.', { pct: 8, size: 14, bold: true, color: C.marine, center: true, fill: C.headGrey }),
      txtCell('Mob.', { pct: 8, size: 14, bold: true, color: C.marine, center: true, fill: C.headGrey }),
      txtCell('Fax / e-mail', { pct: 18, size: 14, bold: true, color: C.marine, center: true, fill: C.headGrey }),
      ...['I', 'P', 'AE', 'AN', 'D'].map((c) => txtCell(c, { pct: 7.2, size: 14, bold: true, color: C.marine, center: true, fill: C.headGrey })),
    ],
  })
  const rows: TableRow[] = [head]
  for (const g of ['MOA', 'MOE', 'ENTREPRISE', 'PARTENAIRES'] as const) {
    const persons = cr.intervenants.filter((i) => i.groupe === g)
    if (persons.length === 0) continue
    rows.push(new TableRow({
      children: [new TableCell({
        columnSpan: 10, borders: cellBorders, shading: { type: ShadingType.SOLID, color: C.orgBlue, fill: C.orgBlue },
        children: [p(GROUP_LABEL[g], { size: 16, bold: true, color: C.marine })],
      })],
    }))
    for (const i of persons) {
      const x = (on: boolean) => txtCell(on ? 'X' : '', { pct: 7.2, size: 16, center: true })
      rows.push(new TableRow({
        children: [
          txtCell(i.organisme, { pct: 13, size: 13, bold: true }),
          txtCell(i.representant, { pct: 17, size: 16 }),
          txtCell(i.tel || '', { pct: 8, size: 14 }),
          txtCell(i.mob || '', { pct: 8, size: 14 }),
          txtCell(i.email || '', { pct: 18, size: 11, color: C.blue }),
          x(i.invite), x(i.presence === 'P'), x(i.presence === 'AE'), x(i.presence === 'AN'), x(i.diffusion),
        ],
      }))
    }
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

// --- points examinés (bloc = 1 ligne : gauche points / droite ACTION) ---
function pointsTable(title: string, blocs: CrBecibBloc[]): Table {
  const head = new TableRow({
    tableHeader: true,
    children: [
      txtCell(title, { pct: 85, size: 16, bold: true, fill: C.band2Grey }),
      txtCell('ACTION', { pct: 15, size: 16, bold: true, center: true, fill: C.band2Grey }),
    ],
  })
  const rows: TableRow[] = [head]
  for (const b of blocs) {
    const left: Paragraph[] = []
    if (b.sousTitre) left.push(p(b.sousTitre, { size: 15, bold: true, underline: true, color: C.marine }))
    for (const pt of b.points) left.push(chevron(pt.texte, pt.statut))
    rows.push(new TableRow({
      children: [
        new TableCell({ width: { size: 85, type: WidthType.PERCENTAGE }, borders: cellBorders, children: left.length ? left : [p('')] }),
        new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, borders: cellBorders, verticalAlign: VerticalAlign.CENTER, children: [p(actionLabel(b.action), { size: 16, bold: true, align: AlignmentType.CENTER })] }),
      ],
    }))
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

// --- planning (matrice : bande catégorie + lignes libellé/valeur) ---
function planningTable(cr: CrBecib): Table {
  const pl = cr.planning
  const sections: { label: string; color: string; rows: [string, string | null][] }[] = [
    { label: 'MARCHÉ', color: C.planMarche, rows: [['Début période de préparation (OS de démarrage)', pl.marche.osDemarrage], ['Délai contractuel', pl.marche.delai], ['Fin du délai contractuel', pl.marche.finContractuelle]] },
    { label: 'INTEMPÉRIES', color: C.planIntemp, rows: [['Intempéries depuis dernière réunion (jours)', pl.intemperies.depuisDerniereReunion], ['Cumul intempéries (jours ouvrables)', pl.intemperies.cumulOuvrable], ['Fin du délai avec intempéries', pl.intemperies.finAvecIntemperies]] },
    { label: 'PROLONGATIONS', color: C.planProl, rows: [['Prolongations', pl.prolongations], ['Fin du délai avec intempéries et prolongations', null]] },
    { label: 'RETARD', color: C.planRetard, rows: [['Retard prévisionnel (jours calendaires)', pl.retard.previsionnel || '0'], ['Retard effectif (jours calendaires)', pl.retard.effectif || '0']] },
  ]
  const rows: TableRow[] = []
  for (const sec of sections) {
    rows.push(new TableRow({ children: [new TableCell({ columnSpan: 2, borders: cellBorders, shading: { type: ShadingType.SOLID, color: C.orgBlue, fill: C.orgBlue }, children: [p(sec.label, { size: 17, bold: true, color: sec.color })] })] }))
    for (const [label, val] of sec.rows) {
      rows.push(new TableRow({
        children: [
          txtCell(label, { pct: 70, size: 16 }),
          txtCell(val || '—', { pct: 30, size: 16, bold: true, color: sec.color }),
        ],
      }))
    }
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

export function buildCrBecibDocx(cr: CrBecib): Document {
  const dLong = cr.meta.dateIso ? dateLong(cr.meta.dateIso) : ''
  const dNum = cr.meta.dateIso ? dateNum(cr.meta.dateIso) : ''
  const breadcrumb = `${cr.meta.moa} / ${cr.meta.moe} / ${cr.meta.chantier} / CR réunion de chantier`

  const body: (Paragraph | Table)[] = []

  // Maître d'ouvrage (centré)
  body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: cr.meta.moa, bold: true, size: 22, color: C.marine })] }))

  // Bloc-titre encadré
  body.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 },
    border: { top: thin, bottom: thin, left: thin, right: thin },
    shading: { type: ShadingType.SOLID, color: 'DCDCE2', fill: 'DCDCE2' },
    children: [new TextRun({ text: cr.meta.projetTitre, bold: true, size: 24, color: C.marine })],
  }))
  body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: `COMPTE-RENDU N°${cr.meta.numeroCR} DE LA RÉUNION DE CHANTIER`, bold: true, underline: {}, size: 20 })] }))
  body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: `Du ${dLong}${cr.meta.semaine ? ` - semaine ${cr.meta.semaine}` : ''}`, bold: true, size: 18 })] }))

  // 1. INTERVENANTS
  body.push(band1('1', 'INTERVENANTS'))
  body.push(new Paragraph({ spacing: { before: 20, after: 40 }, children: [new TextRun({ text: '(I : Invité · P : Présent · AE : Absent excusé · AN : Absent non excusé · D : diffusion)', italics: true, size: 13, color: C.greyText })] }))
  body.push(intervenantsTable(cr))

  // 2. ORDRE DU JOUR
  body.push(band1('2', 'ORDRE DU JOUR'))
  if (cr.ordreDuJour.length) cr.ordreDuJour.forEach((o) => body.push(chevron(o)))
  else body.push(p('—', { color: C.greyText }))

  // 3. REMARQUES
  body.push(band1('3', 'REMARQUES SUR CR PRÉCÉDENT'))
  body.push(p(cr.remarquesCrPrecedent || 'RAS.', { size: 16 }))
  body.push(new Paragraph({ spacing: { before: 20 }, children: [new TextRun({ text: NOTA_48H, italics: true, size: 14, color: C.greyText })] }))

  // 4. POINTS EXAMINÉS
  body.push(band1('4', 'POINTS EXAMINÉS'))
  body.push(pointsTable('POINTS ADMINISTRATIFS', cr.pointsExamines.administratifs))
  body.push(new Paragraph({ ...noSpace, spacing: { after: 60 }, children: [] }))
  body.push(pointsTable('POINTS TECHNIQUES', cr.pointsExamines.techniques))

  // 5. AVANCEMENT, PLANNING
  body.push(band1('5', 'AVANCEMENT, PLANNING'))
  if (cr.avancement.fait.length || cr.avancement.previsions.length) {
    body.push(band2('AVANCEMENT'))
    if (cr.avancement.fait.length) { body.push(subLabel('FAIT')); cr.avancement.fait.forEach((t) => body.push(chevron(t))) }
    if (cr.avancement.previsions.length) { body.push(subLabel('PRÉVISIONS')); cr.avancement.previsions.forEach((t) => body.push(chevron(t))) }
  }
  body.push(band2('INTEMPÉRIES, ALÉAS, PLANNING'))
  cr.intemperiesAleas.forEach((t) => body.push(chevron(t)))
  body.push(subLabel('PLANNING'))
  body.push(planningTable(cr))

  // 6. SÉCURITÉ
  if (cr.securite.length) {
    body.push(band1('6', 'SÉCURITÉ, ENVIRONNEMENT'))
    cr.securite.forEach((t) => body.push(chevron(t)))
  }

  // Prochaine réunion + signature
  body.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 200, after: 0 },
    border: { top: thin, bottom: thin, left: thin, right: thin },
    children: [new TextRun({ text: 'PROCHAINE RÉUNION', bold: true, underline: {}, color: C.marine, size: 18 })],
  }))
  body.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 120 },
    border: { bottom: thin, left: thin, right: thin },
    children: [new TextRun({ text: [cr.prochaineReunion.date, cr.prochaineReunion.heure, cr.prochaineReunion.lieu].filter(Boolean).join(' · ') || 'À planifier.', size: 18 })],
  }))
  body.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 120 }, children: [new TextRun({ text: cr.signature, bold: true, size: 18 })] }))

  // Pied : fil d'Ariane (+ n° de page natif à droite), puis cartouche DNS en
  // VRAIE TABLE bordée (libellés / valeurs), comme le PDF.
  const cartouche = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        txtCell('Numéro DNS', { pct: 40, size: 11, bold: true, color: C.marine, fill: 'F0F2F5' }),
        txtCell('Version', { pct: 14, size: 11, bold: true, color: C.marine, fill: 'F0F2F5' }),
        txtCell('Modification : ordre', { pct: 26, size: 11, bold: true, color: C.marine, fill: 'F0F2F5' }),
        txtCell('Date', { pct: 20, size: 11, bold: true, color: C.marine, fill: 'F0F2F5' }),
      ] }),
      new TableRow({ children: [
        txtCell(cr.meta.dns || '—', { pct: 40, size: 13 }),
        txtCell(cr.meta.version, { pct: 14, size: 13 }),
        txtCell(cr.meta.modification, { pct: 26, size: 13 }),
        txtCell(dNum, { pct: 20, size: 13 }),
      ] }),
    ],
  })
  const footer = new Footer({
    children: [
      new Paragraph({
        ...noSpace,
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: breadcrumb, italics: true, size: 13, color: C.greyText }),
          new TextRun({ text: '\tPage ', size: 14, bold: true, color: C.marine }),
          new TextRun({ children: [PageNumber.CURRENT], size: 14, bold: true, color: C.marine }),
          new TextRun({ text: ' / ', size: 14, bold: true, color: C.marine }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, bold: true, color: C.marine }),
        ],
      }),
      cartouche,
    ],
  })

  // En-tête répété : logo BECIB + filet navy.
  const logoDispW = 120
  const logoDispH = Math.round((logoDispW * LOGO_H) / LOGO_W)
  const header = new Header({
    children: [
      new Paragraph({ spacing: { after: 0 }, children: [new ImageRun({ type: 'png', data: LOGO_BUF, transformation: { width: logoDispW, height: logoDispH } })] }),
      new Paragraph({ ...noSpace, border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: C.marine } }, children: [] }),
    ],
  })

  const pageBorderSide = { style: BorderStyle.SINGLE, size: 8, color: C.marine, space: 24 }
  return new Document({
    creator: 'MemorIA', title: `CR ${cr.meta.numeroCR} — ${cr.meta.chantier}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 16 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1500, bottom: 1100, left: 720, right: 720, header: 360, footer: 280 },
          borders: {
            pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE },
            pageBorderTop: pageBorderSide, pageBorderBottom: pageBorderSide, pageBorderLeft: pageBorderSide, pageBorderRight: pageBorderSide,
          },
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children: body,
    }],
  })
}
