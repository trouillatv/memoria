// Remplit le template Word BECIB (vrai .docx d'Émeline) depuis un objet CrBecib
// et renvoie le buffer DOCX. Source de vérité = le .docx ; React-PDF = fallback.
// La conversion DOCX→PDF est faite à part (LibreOffice en local, Gotenberg prod).
import * as fs from 'fs'
import * as path from 'path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import type { CrBecib } from './cr-becib-schema'

// Chemin du modèle BECIB. En prod il faudra le bundler comme asset.
const TEMPLATE_SRC = path.join(process.cwd(), 'docs/Becib/exemples/LA CRAVACHE GDE - PV 04 du 07 11 25.docx')
const WT = /(<w:t(?: [^>]*)?>)([\s\S]*?)(<\/w:t>)/g // <w:t> STRICT (jamais <w:tc>/<w:tcPr>)

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
function pointsCell(tc: string, blocKey: string): string {
  const paras = tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g)!
  const st = setText(paras[1], `{#${blocKey}}{sousTitre}`)
  const pt = setText(paras[2], `{#points}{texte}{/points}{/${blocKey}}`)
  return tc.replace(paras.slice(1).join(''), st + pt)
}
function actionCell(tc: string, blocKey: string): string {
  const paras = tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g)!
  return tc.replace(paras.join(''), setText(paras[0], `{#${blocKey}}{action}{/${blocKey}}`))
}
// Remplace le TEXTE ENTIER du paragraphe contenant `match` (gère la
// fragmentation des runs Word — un xml.replace brut ne matcherait pas).
function tagWholePara(xml: string, match: string, replacement: string): string {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (pp) => {
    const ts = [...pp.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
    if (!ts.length || !ts.map((m) => m[1]).join('').includes(match)) return pp
    return setText(pp, replacement)
  })
}

// Construit le template tagué (chirurgie minimale, formatage préservé).
function buildTemplate(): Buffer {
  const zip = new PizZip(fs.readFileSync(TEMPLATE_SRC))
  let xml = zip.file('word/document.xml')!.asText()
  const tbls = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)!
  // Participants : boucle {#groupes} (bande corps de métier DANS la boucle) →
  // les groupes vides ne s'affichent plus. {#orgs} = 1 ligne par organisme.
  const t0 = tbls.find((x) => x.includes('Repr'))!
  const r0 = t0.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)!
  const band = setText(r0[1], '{#groupes}{groupeLabel}')
  const orgRow = tagRow(r0[2], ['{#orgs}{organisme}', '{representants}', '{tels}', '{mobs}', '{emails}', '{iMark}', '{pMark}', '{aeMark}', '{anMark}', '{dMarks}{/orgs}{/groupes}'])
  xml = xml.replace(t0, t0.replace(r0.join(''), [r0[0], band, orgRow].join('')))
  // Points examinés
  const t1 = tbls.find((x) => x.includes('POINTS ADMINISTRATIFS'))!
  const r1 = t1.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)!
  const adm = r1[1].match(/<w:tc>[\s\S]*?<\/w:tc>/g)!
  const tec = r1[3].match(/<w:tc>[\s\S]*?<\/w:tc>/g)!
  let t1n = t1.replace(r1[1], r1[1].replace(adm[0], pointsCell(adm[0], 'blocsAdmin')).replace(adm[1], actionCell(adm[1], 'blocsAdmin')))
  t1n = t1n.replace(r1[3], r1[3].replace(tec[0], pointsCell(tec[0], 'blocsTech')).replace(tec[1], actionCell(tec[1], 'blocsTech')))
  xml = xml.replace(t1, t1n)
  // Scalaires (fusion-par-paragraphe : les runs sont fragmentés → xml.replace brut échoue)
  xml = tagWholePara(xml, 'TRAVAUX POUR L', '{projetTitre}')
  xml = tagWholePara(xml, 'EAUX PLUVIALES DU CENTRE', '')
  xml = tagWholePara(xml, 'COMPTE-RENDU', 'COMPTE-RENDU N°{numeroCR} DE LA RÉUNION DE CHANTIER')
  xml = tagWholePara(xml, 'novembre 2025', 'Du {dateLong} - semaine {semaine}')
  // Ordre du jour (liste) + Remarques sur CR précédent
  xml = tagWholePara(xml, 'Suivi des travaux', '{#ordreDuJour}{texte}{/ordreDuJour}')
  xml = tagWholePara(xml, 'corrigé afin de noter', '{remarquesCrPrecedent}')

  // PHOTOS : garder le 1er drawing (logo client en p.1), retirer les photos
  // Cravache figées ; placeholder à la place de la 1re. Les médias orphelins
  // sont élagués plus bas (drop des ~23 Mo).
  let dn = 0
  xml = xml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, (dr) => {
    dn++
    if (dn === 1) return dr // logo client (Image 1)
    if (dn === 2) return '<w:t xml:space="preserve">Photos à insérer (à compléter)</w:t>'
    return ''
  })
  zip.file('word/document.xml', xml)

  let foot = zip.file('word/footer1.xml')!.asText()
  foot = foot.split('2025BEC010/CR004').join('{dns}')
  foot = tagWholePara(foot, 'CR réunion de chantier', '{moaNom} / BECIB / {chantier} / CR réunion de chantier')
  zip.file('word/footer1.xml', foot)

  // --- Élagage des médias orphelins (photos retirées) → réduit la taille ---
  const refIds = new Set<string>()
  for (const m of (xml + (zip.file('word/header1.xml')?.asText() ?? '')).matchAll(/r:embed="([^"]+)"/g)) refIds.add(m[1])
  const keep = new Set<string>()
  const relPaths = ['word/_rels/document.xml.rels', 'word/_rels/header1.xml.rels']
  for (const rp of relPaths) {
    const rels = zip.file(rp)?.asText(); if (!rels) continue
    let cleaned = rels
    for (const rel of rels.match(/<Relationship\b[^>]*\/>/g) ?? []) {
      const id = (rel.match(/Id="([^"]+)"/) ?? [])[1]
      const tgt = (rel.match(/Target="([^"]+)"/) ?? [])[1]
      if (!tgt || !tgt.includes('media/')) continue
      const full = 'word/' + tgt.replace(/^\.\.\//, '').replace(/^\//, '')
      if (id && refIds.has(id)) keep.add(full)
      else cleaned = cleaned.replace(rel, '') // rel orphelin → retiré
    }
    zip.file(rp, cleaned)
  }
  for (const f of Object.keys(zip.files)) {
    if (f.startsWith('word/media/') && !keep.has(f)) zip.remove(f)
  }
  return zip.generate({ type: 'nodebuffer' })
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
function dateLong(iso: string): string {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso || 'à compléter'
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

const GROUP_LABEL: Record<string, string> = { MOA: "MAÎTRISE D'OUVRAGE", MOE: "MAÎTRISE D'ŒUVRE", ENTREPRISE: 'ENTREPRISE TITULAIRE', PARTENAIRES: 'PARTENAIRES' }
const GROUPS = ['MOA', 'MOE', 'ENTREPRISE', 'PARTENAIRES'] as const

type IV = CrBecib['intervenants'][number]
function orgsOf(cr: CrBecib, g: string) {
  const persons = cr.intervenants.filter((i) => i.groupe === g)
  const blocks: IV[][] = []
  for (const pn of persons) { const l = blocks[blocks.length - 1]; if (l && l[0].organisme === pn.organisme) l.push(pn); else blocks.push([pn]) }
  return blocks.map((b) => ({
    organisme: b[0].organisme, representants: b.map((p) => p.representant).join('\n'), tels: b.map((p) => p.tel || '').join('\n'),
    mobs: b.map((p) => p.mob || '').join('\n'), emails: b.map((p) => p.email || '').join('\n'),
    iMark: b[0].invite ? 'X' : '', pMark: b[0].presence === 'P' ? 'X' : '', aeMark: b[0].presence === 'AE' ? 'X' : '', anMark: b[0].presence === 'AN' ? 'X' : '',
    dMarks: b.map((p) => p.diffusion ? 'X' : '').join('\n'),
  }))
}
function blocs(arr: CrBecib['pointsExamines']['administratifs']) {
  return arr.map((b) => ({
    sousTitre: b.sousTitre, action: b.action.join(' / '),
    points: b.points.map((p) => ({ texte: p.texte.replace(/\*\*/g, '') + (p.statut ? `  = ${p.statut}` : '') })),
  }))
}

/** Remplit le template BECIB depuis un CrBecib → buffer DOCX. */
export function buildPvDocx(cr: CrBecib): Buffer {
  const doc = new Docxtemplater(new PizZip(buildTemplate()), { paragraphLoop: true, linebreaks: true })
  doc.render({
    numeroCR: cr.meta.numeroCR || 'à compléter', dateLong: dateLong(cr.meta.dateIso), semaine: cr.meta.semaine || 'à compléter', dns: cr.meta.dns || 'à compléter',
    projetTitre: cr.meta.projetTitre || 'à compléter', moaNom: cr.meta.moa || 'à compléter', chantier: cr.meta.chantier || 'à compléter',
    groupes: GROUPS.map((g) => ({ groupeLabel: GROUP_LABEL[g], orgs: orgsOf(cr, g) })).filter((x) => x.orgs.length > 0),
    ordreDuJour: cr.ordreDuJour.map((t) => ({ texte: t })),
    remarquesCrPrecedent: cr.remarquesCrPrecedent || 'RAS.',
    blocsAdmin: blocs(cr.pointsExamines.administratifs), blocsTech: blocs(cr.pointsExamines.techniques),
  })
  return doc.getZip().generate({ type: 'nodebuffer' })
}
