// Export Excel de la Vue Semaine.
//
// Route GET /semaine/export?week=YYYY-Www
//
// Doctrine V2 + V6.1 (Vincent 2026-05-20) :
//   - Pas de KPI agrégé, pas de "performance" — juste l'organisation brute.
//   - Pas de noms d'agents : on garde le NIVEAU ÉQUIPE.
//   - Colonne « Horaire » : heure réelle de prestation (planned_start). Plus
//     de colonne « Créneau » côté utilisateur.
//
// Auth : admin OU manager (même garde que /semaine).

import { NextResponse, type NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getUserRoleById } from '@/lib/db/users'
import {
  formatWeekParam,
  listInterventionsForWeek,
  parseWeekParam,
} from '@/lib/db/week-planning'
import { listTeamsWithMemberCount } from '@/lib/db/teams'
import { fmtHourFr } from '@/lib/time/prestation-slot'

const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const STATUS_LABELS_FR: Record<string, string> = {
  planned: 'Planifiée',
  in_progress: 'En cours',
  completed: 'Exécutée',
  validated: 'Validée',
  skipped: 'Sautée',
}
// V6.1 (Vincent 2026-05-20) : plus de labels « Matin / Après-midi / Soir »
// dans l'export. La colonne « Horaire » utilise fmtHourFr(planned_start).

// Couleur de marque (cf. app/globals.css --color-brand-600).
const BRAND_BLUE = 'FF2563EB'
const BRAND_BLUE_PALE = 'FFEFF6FF'
const NEUTRAL_HEADER = 'FFF1F5F9'

/** Palette pour les badges de statut (fond pâle + texte saturé, lecture rapide
 * sans agressivité — doctrine V2 : on signale, on n'alarme pas). */
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  planned:     { bg: 'FFF1F5F9', fg: 'FF475569' }, // slate
  in_progress: { bg: 'FFFFEDD5', fg: 'FFC2410C' }, // orange
  completed:   { bg: 'FFDBEAFE', fg: 'FF1D4ED8' }, // blue
  validated:   { bg: 'FFD1FAE5', fg: 'FF047857' }, // emerald
  skipped:     { bg: 'FFFEF3C7', fg: 'FFB45309' }, // amber (signal, pas alarme)
}

/** Convertit un hex `#rrggbb` → ARGB pâle (15% couleur + 85% blanc). Donne un
 * fond doux compatible avec du texte sombre, cohérent avec la grille à l'écran. */
function hexToPaleArgb(hex: string | null | undefined): string | null {
  if (!hex) return null
  const clean = hex.replace(/^#/, '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c * 0.15 + 255 * 0.85)
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
  return 'FF' + toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b))
}

/** Variante "texte" : on garde la couleur saturée d'origine (60% intensité) pour
 * que le label reste lisible sur le fond pâle. */
function hexToSaturatedArgb(hex: string | null | undefined): string | null {
  if (!hex) return null
  const clean = hex.replace(/^#/, '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  // Assombrir un peu (×0.7) pour contraster avec le fond pâle.
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  const darken = (c: number) => Math.round(c * 0.7)
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
  return 'FF' + toHex(darken(r)) + toHex(darken(g)) + toHex(darken(b))
}

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function dayLabelForIso(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const dow = d.getUTCDay() // 0=Sun
  const idx = dow === 0 ? 6 : dow - 1
  return DAY_LABELS[idx] ?? ''
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS_FR[(m ?? 1) - 1]} ${y}`
}

function formatWeekTitle(range: { weekNumber: number; weekStart: string; weekEnd: string; year: number }): string {
  return `Planning · Semaine ${range.weekNumber} · du ${formatDateLong(range.weekStart)} au ${formatDateLong(range.weekEnd)}`
}

export async function GET(req: NextRequest) {
  // Auth — manager+ uniquement
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Non authentifié', { status: 401 })
  }
  const role = await getUserRoleById(user.id)
  if (role !== 'admin' && role !== 'manager') {
    return new NextResponse('Accès refusé', { status: 403 })
  }

  const weekParam = req.nextUrl.searchParams.get('week')
  const range = parseWeekParam(weekParam)
  const [cells, allTeams] = await Promise.all([
    listInterventionsForWeek(range),
    listTeamsWithMemberCount(),
  ])

  // Lookup rapide team_id → {memberCount, color} (utilisé pour les colonnes
  // Effectif et Couleur dans le sheet Planning).
  const teamById = new Map(allTeams.map((t) => [t.id, t]))

  const wb = new ExcelJS.Workbook()
  wb.creator = 'MemorIA'
  wb.created = new Date()
  const sheet = wb.addWorksheet(`Semaine ${range.weekNumber}`)

  // Largeurs de colonnes (10 colonnes : A → J)
  // Date · Jour · Horaire · Contrat · Site · Mission · Équipe · Couleur · Effectif · Statut
  const widths = [12, 12, 12, 30, 30, 32, 22, 10, 11, 14]
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w
  })

  // ----- Bandeau d'en-tête (lignes 1-3) -----

  // Ligne 1 : titre principal en blanc sur bandeau brand-blue
  sheet.mergeCells('A1:J1')
  const titleCell = sheet.getCell('A1')
  titleCell.value = formatWeekTitle(range)
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BRAND_BLUE },
  }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  sheet.getRow(1).height = 26

  // Ligne 2 : sous-titre (identifiant semaine + créateur, fond pâle)
  sheet.mergeCells('A2:J2')
  const subCell = sheet.getCell('A2')
  subCell.value = `Identifiant semaine : ${formatWeekParam(range)} · Export MemorIA · ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}`
  subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } }
  subCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BRAND_BLUE_PALE },
  }
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  sheet.getRow(2).height = 18

  // Ligne 3 : séparateur fin
  sheet.getRow(3).height = 6

  // ----- Ligne 4 : en-têtes de colonnes -----

  const HEADER_ROW = 4
  const headers = ['Date', 'Jour', 'Horaire', 'Contrat', 'Site', 'Mission', 'Équipe', 'Couleur', 'Effectif', 'Statut']
  const COL_TEAM = 7
  const COL_COLOR = 8
  const COL_HEADCOUNT = 9
  const COL_STATUS = 10
  const headerRow = sheet.getRow(HEADER_ROW)
  headers.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = label
    cell.font = { bold: true, color: { argb: 'FF0F172A' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEUTRAL_HEADER } }
    cell.alignment = { vertical: 'middle' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
  })
  headerRow.height = 20

  // Geler les 4 premières lignes (bandeau + en-têtes restent visibles au scroll)
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW }]

  // ----- Lignes 5+ : données -----

  // Tri : date, planned_start (heure ascendante), contrat, site, mission
  const fr = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' })
  const sorted = [...cells].sort((a, b) => {
    if (a.scheduled_for !== b.scheduled_for) return a.scheduled_for < b.scheduled_for ? -1 : 1
    // V6.1 — tri par planned_start ascendant (nulls last) plutôt que par slot.
    const ax = a.planned_start ?? '~'
    const bx = b.planned_start ?? '~'
    if (ax !== bx) return ax < bx ? -1 : 1
    return fr(a.contract_name, b.contract_name) || fr(a.site_name, b.site_name) || fr(a.mission_name, b.mission_name)
  })

  for (const c of sorted) {
    const team = c.assigned_team_id ? teamById.get(c.assigned_team_id) : null
    const memberCount = team?.memberCount ?? null
    const row = sheet.addRow([
      c.scheduled_for,
      dayLabelForIso(c.scheduled_for),
      // V6.1 — colonne « Horaire » : heure de prestation réelle.
      fmtHourFr(c.planned_start),
      c.contract_name,
      c.site_name,
      c.mission_name,
      c.assigned_team_name ?? 'Non-affecté',
      c.assigned_team_color ?? '',
      memberCount !== null ? memberCount : '',
      STATUS_LABELS_FR[c.status] ?? c.status,
    ])

    // Badge équipe : fond pâle + texte saturé. "Non-affecté" = italique ambre
    // (doctrine V2 : signal ambre, jamais rouge).
    const teamCell = row.getCell(COL_TEAM)
    if (c.assigned_team_name && c.assigned_team_color) {
      const bg = hexToPaleArgb(c.assigned_team_color)
      const fg = hexToSaturatedArgb(c.assigned_team_color)
      if (bg) teamCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      if (fg) teamCell.font = { color: { argb: fg }, bold: true }
    } else if (!c.assigned_team_name) {
      teamCell.font = { italic: true, color: { argb: 'FFB45309' } }
      teamCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
    }

    // Swatch de couleur : fond saturé sur la couleur exacte de l'équipe, hex en
    // texte blanc pour l'accessibilité (un manager daltonien lit le code).
    const colorCell = row.getCell(COL_COLOR)
    if (c.assigned_team_color) {
      const clean = c.assigned_team_color.replace(/^#/, '').toUpperCase()
      if (/^[0-9A-F]{6}$/.test(clean)) {
        colorCell.value = `#${clean}`
        colorCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + clean } }
        colorCell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 9, name: 'Consolas' }
        colorCell.alignment = { horizontal: 'center' }
      }
    }

    // Effectif : info descriptive (doctrine V2 — JAMAIS un KPI). Aligné à droite,
    // gris discret. Vide si pas d'équipe affectée.
    const headcountCell = row.getCell(COL_HEADCOUNT)
    if (memberCount !== null) {
      headcountCell.alignment = { horizontal: 'right' }
      headcountCell.font = { color: { argb: 'FF64748B' } }
    }

    // Badge statut : fond pâle + texte saturé selon STATUS_STYLE.
    const statusCell = row.getCell(COL_STATUS)
    const style = STATUS_STYLE[c.status]
    if (style) {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.bg } }
      statusCell.font = { color: { argb: style.fg }, bold: true }
      statusCell.alignment = { horizontal: 'center' }
    }
  }

  // Si zéro intervention, on ajoute une ligne informative (l'export reste exploitable même pour une semaine vide).
  if (sorted.length === 0) {
    const empty = sheet.addRow([
      range.weekStart,
      '—',
      '—',
      'Aucune intervention planifiée sur cette semaine.',
    ])
    empty.font = { italic: true, color: { argb: 'FF64748B' } }
  }

  // Auto-filter sur la ligne d'en-têtes
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: headers.length },
  }

  // ============================================================================
  // Sheet 2 — "Effectifs" : liste des équipes + taille (info descriptive)
  // ============================================================================
  //
  // Doctrine V2 : feuille séparée pour bien marquer que c'est de l'INFO RH
  // descriptive (qui est dans quelle équipe, combien de personnes), JAMAIS
  // une métrique de performance/charge.

  const teamSheet = wb.addWorksheet('Effectifs')
  teamSheet.getColumn(1).width = 28
  teamSheet.getColumn(2).width = 12
  teamSheet.getColumn(3).width = 12
  teamSheet.getColumn(4).width = 14

  // Bandeau d'en-tête, même charte que Planning
  teamSheet.mergeCells('A1:D1')
  const tTitle = teamSheet.getCell('A1')
  tTitle.value = 'Effectifs des équipes'
  tTitle.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  tTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_BLUE } }
  tTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  teamSheet.getRow(1).height = 26

  teamSheet.mergeCells('A2:D2')
  const tSub = teamSheet.getCell('A2')
  tSub.value = "Info descriptive · jamais utilisée comme métrique de charge ou de performance."
  tSub.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } }
  tSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_BLUE_PALE } }
  tSub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  teamSheet.getRow(2).height = 18
  teamSheet.getRow(3).height = 6

  const T_HEADER_ROW = 4
  const teamHeaders = ['Équipe', 'Couleur', 'Effectif', 'Statut']
  const teamHeaderRow = teamSheet.getRow(T_HEADER_ROW)
  teamHeaders.forEach((label, i) => {
    const cell = teamHeaderRow.getCell(i + 1)
    cell.value = label
    cell.font = { bold: true, color: { argb: 'FF0F172A' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEUTRAL_HEADER } }
    cell.alignment = { vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
  })
  teamHeaderRow.height = 20

  teamSheet.views = [{ state: 'frozen', ySplit: T_HEADER_ROW }]

  // Tri alphabétique français, équipes actives en premier, archivées ensuite
  const sortedTeams = [...allTeams].sort((a, b) => {
    if (!!a.deleted_at !== !!b.deleted_at) return a.deleted_at ? 1 : -1
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
  })

  for (const t of sortedTeams) {
    const archived = !!t.deleted_at
    const row = teamSheet.addRow([
      t.name,
      t.color ?? '',
      t.memberCount,
      archived ? 'Archivée' : (t.active ? 'Active' : 'Inactive'),
    ])

    // Badge équipe (même style que sheet Planning)
    const nameCell = row.getCell(1)
    if (t.color) {
      const bg = hexToPaleArgb(t.color)
      const fg = hexToSaturatedArgb(t.color)
      if (bg) nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      if (fg) nameCell.font = { color: { argb: fg }, bold: true }
    }
    if (archived) {
      nameCell.font = { italic: true, color: { argb: 'FF94A3B8' } }
    }

    // Swatch couleur
    const colorCell = row.getCell(2)
    if (t.color) {
      const clean = t.color.replace(/^#/, '').toUpperCase()
      if (/^[0-9A-F]{6}$/.test(clean)) {
        colorCell.value = `#${clean}`
        colorCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + clean } }
        colorCell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 9, name: 'Consolas' }
        colorCell.alignment = { horizontal: 'center' }
      }
    }

    // Effectif aligné à droite
    row.getCell(3).alignment = { horizontal: 'right' }

    // Badge statut
    const statusCell = row.getCell(4)
    if (archived) {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
      statusCell.font = { color: { argb: 'FF94A3B8' }, italic: true }
    } else if (t.active) {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }
      statusCell.font = { color: { argb: 'FF047857' }, bold: true }
    } else {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
      statusCell.font = { color: { argb: 'FFB45309' } }
    }
    statusCell.alignment = { horizontal: 'center' }
  }

  if (sortedTeams.length === 0) {
    const empty = teamSheet.addRow(['Aucune équipe enregistrée.'])
    empty.font = { italic: true, color: { argb: 'FF64748B' } }
  }

  teamSheet.autoFilter = {
    from: { row: T_HEADER_ROW, column: 1 },
    to: { row: T_HEADER_ROW, column: teamHeaders.length },
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `planning-${formatWeekParam(range)}.xlsx`

  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
