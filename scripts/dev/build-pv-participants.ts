// Boucle participants FIABLE : bandes corps de métier STATIQUES (rôles fixes),
// chaque ligne organisme = boucle d'UNE ligne {#moa}…{/moa} etc. (pas de boucle
// inter-lignes). 1 ligne/organisme, personnes empilées (\n), I/P/AE/AN niveau
// organisme, D par personne.
import * as fs from 'fs'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { CRAVACHE_FIXTURE as cr } from '@/lib/documents/fixtures/cravache'

const SRC = 'docs/Becib/exemples/LA CRAVACHE GDE - PV 04 du 07 11 25.docx'

function setCell(tc: string, text: string): string {
  let i = 0
  let out = tc.replace(/(<w:t(?: [^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_m, o, _x, c) => (++i === 1 ? o + text + c : o + c))
  if (i === 0) out = tc.replace('</w:p>', `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
  return out
}
function tagRow(tr: string, tags: string[]): string {
  let k = 0
  return tr.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (tc) => (k < tags.length ? setCell(tc, tags[k++]) : tc))
}
const cells = (key: string) => [`{#${key}}{organisme}`, '{representants}', '{tels}', '{mobs}', '{emails}', '{iMark}', '{pMark}', '{aeMark}', '{anMark}', `{dMarks}{/${key}}`]

const zip = new PizZip(fs.readFileSync(SRC))
let xml = zip.file('word/document.xml')!.asText()
const tbl = (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).find((x) => x.includes('Repr'))!
const rows = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)!
// rows: 0=entête, 1=bande MOA, 2=org MOA, 3=bande MOE, 4=org MOE, 5=bande ENT, 6=org ENT, 7=bande PART, 8=org PART, 9=vide
const newRows = [rows[0], rows[1], tagRow(rows[2], cells('moa')), rows[3], tagRow(rows[4], cells('moe')), rows[5], tagRow(rows[6], cells('ent')), rows[7], tagRow(rows[8], cells('part'))]
xml = xml.replace(tbl, tbl.replace(rows.join(''), newRows.join('')))
xml = xml.replace('N°04', 'N°{numeroCR}').replace('Du 07 novembre 2025 - semaine 45', 'Du {dateLong} - semaine {semaine}')
zip.file('word/document.xml', xml)
zip.file('word/footer1.xml', zip.file('word/footer1.xml')!.asText().split('2025BEC010/CR004').join('{dns}'))
const tplBuf = zip.generate({ type: 'nodebuffer' })
fs.writeFileSync('.preview/pv-template.docx', tplBuf)

const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
const d = new Date(cr.meta.dateIso)
const dateLong = `${String(d.getUTCDate()).padStart(2,'0')} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
type IV = (typeof cr.intervenants)[number]
function orgsOf(g: string) {
  const persons = cr.intervenants.filter((i) => i.groupe === g)
  const blocks: IV[][] = []
  for (const pn of persons) { const last = blocks[blocks.length-1]; if (last && last[0].organisme===pn.organisme) last.push(pn); else blocks.push([pn]) }
  return blocks.map((b) => ({
    organisme: b[0].organisme, representants: b.map((p)=>p.representant).join('\n'), tels: b.map((p)=>p.tel||'').join('\n'),
    mobs: b.map((p)=>p.mob||'').join('\n'), emails: b.map((p)=>p.email||'').join('\n'),
    iMark: b[0].invite?'X':'', pMark: b[0].presence==='P'?'X':'', aeMark: b[0].presence==='AE'?'X':'', anMark: b[0].presence==='AN'?'X':'',
    dMarks: b.map((p)=>p.diffusion?'X':'').join('\n'),
  }))
}
const doc = new Docxtemplater(new PizZip(tplBuf), { paragraphLoop: true, linebreaks: true })
doc.render({ numeroCR: cr.meta.numeroCR, dateLong, semaine: cr.meta.semaine, dns: cr.meta.dns, moa: orgsOf('MOA'), moe: orgsOf('MOE'), ent: orgsOf('ENTREPRISE'), part: orgsOf('PARTENAIRES') })
fs.writeFileSync('.preview/pv-rempli.docx', doc.getZip().generate({ type: 'nodebuffer' }))
console.log('✓ pv-rempli.docx généré')
