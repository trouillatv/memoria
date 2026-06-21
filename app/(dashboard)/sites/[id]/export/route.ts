// S2 — Export ZIP « propriété des données » d'un chantier.
//
// GET /sites/[id]/export → un ZIP contenant :
//   - donnees.xlsx (Réunions, Actions, Réserves, Obligations, Sujets, Décisions,
//     + index Photos / Documents)
//   - photos/*           (binaires, bucket intervention-photos)
//   - documents/*        (binaires, bucket documents, hors litige)
//
// Répond à la peur « que se passe-t-il si MemorIA disparaît » (Guillaume) : la
// donnée et les preuves restent la propriété du client, exportables en 1 clic.
// Auth : admin OU manager (même garde que les autres exports).

import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import PizZip from 'pizzip'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { gatherSiteExport, type SiteExportBinary } from '@/lib/db/site-export'

export const dynamic = 'force-dynamic'

const BRAND = 'FF2563EB'
const PALE = 'FFEFF6FF'

const ACTION_STATUS: Record<string, string> = { open: 'Ouverte', planned: 'Planifiée', done: 'Faite', cancelled: 'Annulée' }
const RESERVE_STATUS: Record<string, string> = { open: 'Ouverte', lifted: 'Levée' }
const OBLIGATION_STATUS: Record<string, string> = { a_produire: 'À produire', en_cours: 'En cours', satisfaite: 'Satisfaite', non_applicable: 'Non applicable' }

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Ajoute une feuille « tableau » : bandeau + en-têtes + lignes. */
function addSheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: (string | number)[][]) {
  const sheet = wb.addWorksheet(name)
  headers.forEach((_, i) => { sheet.getColumn(i + 1).width = i === 0 ? 30 : 20 })

  sheet.mergeCells(1, 1, 1, headers.length)
  const title = sheet.getCell(1, 1)
  title.value = name
  title.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  sheet.getRow(1).height = 24

  const headerRow = sheet.getRow(3)
  headers.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = label
    cell.font = { bold: true, color: { argb: 'FF1E293B' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }
  })

  for (const r of rows) sheet.addRow(r)
  if (rows.length === 0) {
    const empty = sheet.addRow(['Aucune donnée.'])
    empty.font = { italic: true, color: { argb: 'FF64748B' } }
  }
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserWithProfile()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })
  if (user.role !== 'admin' && user.role !== 'manager') return new NextResponse('Accès refusé', { status: 403 })

  const { id } = await params
  const data = await gatherSiteExport(id)
  if (!data) return new NextResponse('Chantier introuvable', { status: 404 })
  if (user.organization_id && data.site.organizationId && data.site.organizationId !== user.organization_id) {
    return new NextResponse('Accès refusé', { status: 403 })
  }

  // ── Classeur XLSX ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  wb.creator = 'MemorIA'
  wb.created = new Date()

  addSheet(wb, 'Réunions', ['Date', 'Titre', 'Type', 'Statut', 'Prochaine réunion'],
    data.reports.map((r) => [fmtDate(r.created_at), r.title ?? '', r.type ?? '', r.status ?? '', fmtDate(r.next_meeting_at)]))

  addSheet(wb, 'Actions', ['Titre', 'Responsable', "Corps d'état", 'Statut', 'Échéance', 'Créée le', 'Déclaration entreprise'],
    data.actions.map((a) => [
      a.title, a.assigned_to ?? '', a.corps_etat ?? '', ACTION_STATUS[a.status] ?? a.status,
      fmtDate(a.due_date), fmtDate(a.created_at),
      a.ext_status ? `${a.ext_status === 'done' ? 'Déclaré fait' : 'Déclaré bloqué'}${a.ext_by ? ` · ${a.ext_by}` : ''}` : '',
    ]))

  addSheet(wb, 'Réserves', ['Réserve', 'Localisation', 'Émetteur', 'Émise le', 'Statut', 'Levée le', 'Note de levée'],
    data.reserves.map((r) => [
      r.label, r.location ?? '', r.issuedBy ?? '', fmtDate(r.issuedOn), RESERVE_STATUS[r.status] ?? r.status,
      fmtDate(r.liftedAt), r.liftNote ?? '',
    ]))

  addSheet(wb, 'Obligations', ['Libellé', 'Responsable', 'Importance', 'Statut', 'Négligée', 'Raison'],
    data.obligations.map((o) => [
      o.label, o.responsibleRole, o.importance, OBLIGATION_STATUS[o.status] ?? o.status,
      o.neglected ? 'Oui' : '', o.healthReason ?? '',
    ]))

  addSheet(wb, 'Sujets', ['Nom', 'Statut', 'Criticité', 'Actions ouvertes', 'Réserves ouvertes', 'Décisions', 'Dernière activité'],
    data.subjects.map((s) => [
      s.name, s.status, s.criticality, s.openActions, s.openReserves, s.decisions, fmtDate(s.lastActivity),
    ]))

  addSheet(wb, 'Décisions', ['Titre', 'Sujet', 'Décisionnaire', 'Date', 'Échéance', 'Statut', 'Impact'],
    data.decisions.map((d) => [
      d.titre, d.sujet ?? '', [d.decisionnaireRole, d.decisionnaireOrg].filter(Boolean).join(' · '),
      fmtDate(d.dateDecision), fmtDate(d.echeance), d.statut, d.impact ?? '',
    ]))

  addSheet(wb, 'Photos (index)', ['Fichier', 'Légende'], data.photos.map((p) => [`photos/${p.name}`, p.caption]))
  addSheet(wb, 'Documents (index)', ['Fichier', 'Type'], data.documents.map((d) => [`documents/${d.name}`, d.caption]))

  const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer())

  // ── ZIP ─────────────────────────────────────────────────────────────────────
  const zip = new PizZip()
  const siteSlug = (data.site.name || 'chantier').replace(/[^a-zA-Z0-9-_ ]/g, '_').slice(0, 60).trim() || 'chantier'
  zip.file(`${siteSlug}/donnees.xlsx`, xlsxBuffer)

  const supabase = createAdminClient()
  async function addBinaries(bucket: string, items: SiteExportBinary[], folder: string) {
    const seen = new Set<string>()
    for (const it of items) {
      // Évite les collisions de noms (deux fichiers homonymes).
      let name = it.name
      let n = 1
      while (seen.has(name)) { name = `${n}-${it.name}`; n++ }
      seen.add(name)
      try {
        const { data: blob } = await supabase.storage.from(bucket).download(it.path)
        if (!blob) continue
        const buf = Buffer.from(await blob.arrayBuffer())
        zip.file(`${siteSlug}/${folder}/${name}`, buf)
      } catch {
        // fichier manquant / illisible → on saute, l'export reste exploitable
      }
    }
  }
  await addBinaries('intervention-photos', data.photos, 'photos')
  await addBinaries('documents', data.documents, 'documents')

  const zipBytes = zip.generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array
  // Copie dans un ArrayBuffer simple (BodyInit non ambigu — évite le générique
  // ArrayBufferLike/SharedArrayBuffer des TypedArray récents).
  const body = new ArrayBuffer(zipBytes.byteLength)
  new Uint8Array(body).set(zipBytes)
  const filename = `export-${siteSlug}.zip`

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
