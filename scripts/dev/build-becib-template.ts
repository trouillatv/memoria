// V1 template BECIB : tague PRÉCISÉMENT des champs scalaires dans le vrai .docx
// (fusion des runs UNIQUEMENT sur les paragraphes ciblés → le reste intact),
// puis remplit depuis MemorIA et convertit en PDF (LibreOffice, étape externe).
import * as fs from 'fs'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { CRAVACHE_FIXTURE as cr } from '@/lib/documents/fixtures/cravache'

const SRC = 'docs/Becib/exemples/LA CRAVACHE GDE - PV 04 du 07 11 25.docx'
const PRE = '.preview'

// Remplace des sous-chaînes par des balises, en ne fusionnant QUE les
// paragraphes qui contiennent une cible (les autres restent tels quels).
function tagXml(xml: string, repl: [string, string][]): string {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (pp) => {
    const ts = [...pp.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    if (!ts.length) return pp
    const full = ts.map((m) => m[1]).join('')
    let out = full
    for (const [from, to] of repl) if (out.includes(from)) out = out.split(from).join(to)
    if (out === full) return pp
    let i = 0
    return pp.replace(/(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g, (_m, o, _inner, c) => (++i === 1 ? o + out + c : o + c))
  })
}

const zip = new PizZip(fs.readFileSync(SRC))
const docRepl: [string, string][] = [
  ['N°04', 'N°{numeroCR}'],
  ['Du 07 novembre 2025 - semaine 45', 'Du {dateLong} - semaine {semaine}'],
]
const footRepl: [string, string][] = [
  ['2025BEC010/CR004', '{dns}'],
  ['LA CRAVACHE GDE', '{chantier}'],
]
zip.file('word/document.xml', tagXml(zip.file('word/document.xml')!.asText(), docRepl))
if (zip.file('word/footer1.xml')) zip.file('word/footer1.xml', tagXml(zip.file('word/footer1.xml')!.asText(), footRepl))
const tpl = zip.generate({ type: 'nodebuffer' })
fs.writeFileSync(`${PRE}/becib-template.docx`, tpl)

// Remplit depuis MemorIA (données de la fixture).
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const d = new Date(cr.meta.dateIso)
const dateLong = `${String(d.getUTCDate()).padStart(2, '0')} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
const doc = new Docxtemplater(new PizZip(tpl), { paragraphLoop: true, linebreaks: true })
doc.render({ numeroCR: cr.meta.numeroCR, dateLong, semaine: cr.meta.semaine, dns: cr.meta.dns, chantier: cr.meta.chantier })
fs.writeFileSync(`${PRE}/becib-rempli.docx`, doc.getZip().generate({ type: 'nodebuffer' }))
console.log('✓ becib-template.docx + becib-rempli.docx')
