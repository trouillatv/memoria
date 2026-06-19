// Template PV BECIB complet (V2) : scalaires + boucle participants + boucle
// points examinés (admin/tech) + actions. Tague le VRAI .docx, remplit depuis
// MemorIA, sortie .docx (→ PDF via LibreOffice). React-PDF en fallback.
import * as fs from 'fs'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { CRAVACHE_FIXTURE as cr } from '@/lib/documents/fixtures/cravache'

const SRC = 'docs/Becib/exemples/LA CRAVACHE GDE - PV 04 du 07 11 25.docx'
const WT = /(<w:t(?: [^>]*)?>)([\s\S]*?)(<\/w:t>)/g // <w:t> STRICT (pas <w:tc>/<w:tcPr>)

// 1er <w:t> = texte, autres vidés ; si aucun, injecte un run.
function setText(frag: string, text: string): string {
  let i = 0
  let out = frag.replace(WT, (_m, o, _x, c) => (++i === 1 ? o + text + c : o + c))
  if (i === 0) out = frag.replace('</w:p>', `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
  return out
}
function tagRow(tr: string, tags: string[]): string {
  let k = 0
  return tr.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (tc) => (k < tags.length ? setText(tc, tags[k++]) : tc))
}
const ivCells = (key: string) => [`{#${key}}{organisme}`, '{representants}', '{tels}', '{mobs}', '{emails}', '{iMark}', '{pMark}', '{aeMark}', '{anMark}', `{dMarks}{/${key}}`]

// Reconstruit une cellule de POINTS : garde le 1er paragraphe (vide), puis 1
// paragraphe sous-titre template + 1 paragraphe point template (le reste est
// généré par la boucle). open/close = balises de boucle.
function pointsCell(tc: string, blocKey: string): string {
  const paras = tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g)!
  const st = setText(paras[1], `{#${blocKey}}{sousTitre}`)
  const pt = setText(paras[2], `{#points}{texte}{/points}{/${blocKey}}`)
  return tc.replace(paras.slice(1).join(''), st + pt)
}
function actionCell(tc: string, blocKey: string): string {
  // collapse à 1 paragraphe = boucle des actions
  const paras = tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g)!
  const one = setText(paras[0], `{#${blocKey}}{action}{/${blocKey}}`)
  return tc.replace(paras.join(''), one)
}

const zip = new PizZip(fs.readFileSync(SRC))
let xml = zip.file('word/document.xml')!.asText()
const tbls = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!

// --- TABLE 0 : participants ---
const t0 = tbls.find((x) => x.includes('Repr'))!
const r0 = t0.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)!
const newR0 = [r0[0], r0[1], tagRow(r0[2], ivCells('moa')), r0[3], tagRow(r0[4], ivCells('moe')), r0[5], tagRow(r0[6], ivCells('ent')), r0[7], tagRow(r0[8], ivCells('part'))]
xml = xml.replace(t0, t0.replace(r0.join(''), newR0.join('')))

// --- TABLE 1 : points examinés (admin/tech) ---
const t1 = tbls.find((x) => x.includes('POINTS ADMINISTRATIFS'))!
const r1 = t1.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)!
// r1[1] = ligne admin [gauche points, droite ACTION] ; r1[3] = ligne tech
const adm = r1[1].match(/<w:tc>[\s\S]*?<\/w:tc>/g)!
const tec = r1[3].match(/<w:tc>[\s\S]*?<\/w:tc>/g)!
const newAdmRow = r1[1].replace(adm[0], pointsCell(adm[0], 'blocsAdmin')).replace(adm[1], actionCell(adm[1], 'blocsAdmin'))
let t1n = t1.replace(r1[1], newAdmRow)
const newTecRow = r1[3].replace(tec[0], pointsCell(tec[0], 'blocsTech')).replace(tec[1], actionCell(tec[1], 'blocsTech'))
t1n = t1n.replace(r1[3], newTecRow)
xml = xml.replace(t1, t1n)

// scalaires
xml = xml.replace('N°04', 'N°{numeroCR}').replace('Du 07 novembre 2025 - semaine 45', 'Du {dateLong} - semaine {semaine}')
zip.file('word/document.xml', xml)
zip.file('word/footer1.xml', zip.file('word/footer1.xml')!.asText().split('2025BEC010/CR004').join('{dns}'))
const tplBuf = zip.generate({ type: 'nodebuffer' })
fs.writeFileSync('.preview/pv-template.docx', tplBuf)

// --- Données MemorIA ---
const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
const d = new Date(cr.meta.dateIso)
const dateLong = `${String(d.getUTCDate()).padStart(2,'0')} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
type IV = (typeof cr.intervenants)[number]
function orgsOf(g: string) {
  const persons = cr.intervenants.filter((i) => i.groupe === g)
  const blocks: IV[][] = []
  for (const pn of persons) { const l = blocks[blocks.length-1]; if (l && l[0].organisme===pn.organisme) l.push(pn); else blocks.push([pn]) }
  return blocks.map((b) => ({
    organisme: b[0].organisme, representants: b.map((p)=>p.representant).join('\n'), tels: b.map((p)=>p.tel||'').join('\n'),
    mobs: b.map((p)=>p.mob||'').join('\n'), emails: b.map((p)=>p.email||'').join('\n'),
    iMark: b[0].invite?'X':'', pMark: b[0].presence==='P'?'X':'', aeMark: b[0].presence==='AE'?'X':'', anMark: b[0].presence==='AN'?'X':'',
    dMarks: b.map((p)=>p.diffusion?'X':'').join('\n'),
  }))
}
const blocs = (arr: typeof cr.pointsExamines.administratifs) => arr.map((b) => ({
  sousTitre: b.sousTitre, action: b.action.join(' / '),
  points: b.points.map((p) => ({ texte: p.texte.replace(/\*\*/g, '') + (p.statut ? `  = ${p.statut}` : '') })),
}))
const doc = new Docxtemplater(new PizZip(tplBuf), { paragraphLoop: true, linebreaks: true })
doc.render({
  numeroCR: cr.meta.numeroCR, dateLong, semaine: cr.meta.semaine, dns: cr.meta.dns,
  moa: orgsOf('MOA'), moe: orgsOf('MOE'), ent: orgsOf('ENTREPRISE'), part: orgsOf('PARTENAIRES'),
  blocsAdmin: blocs(cr.pointsExamines.administratifs), blocsTech: blocs(cr.pointsExamines.techniques),
})
fs.writeFileSync('.preview/pv-rempli.docx', doc.getZip().generate({ type: 'nodebuffer' }))
console.log('✓ pv-rempli.docx (participants + points)')
