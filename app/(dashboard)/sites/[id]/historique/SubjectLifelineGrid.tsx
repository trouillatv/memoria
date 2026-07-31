'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { SiteSubjectMatrix, SubjectMatrixRow, MatrixCell } from '@/lib/documents/pv-history'

// ── Icônes de cellule ─────────────────────────────────────────────────────────

type CellIcon = '○' | '●' | '⚠' | '✓' | '✖' | '↩' | '↗' | '~' | '╌'

interface CellStyle {
  icon: CellIcon
  bg: string
  text: string
  title: string
}

function cellStyle(cell: MatrixCell | null): CellStyle {
  if (cell === null) return { icon: '╌', bg: 'bg-transparent', text: 'text-transparent', title: '' }
  if (cell.isGap) return { icon: '╌', bg: 'bg-muted/30', text: 'text-muted-foreground/40', title: 'Non mentionné dans ce PV' }

  const t = cell.transition
  const s = cell.status

  if (t === null) return { icon: '○', bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-600 dark:text-blue-400', title: 'Première apparition' }
  if (t === 'réalisé' || t === 'levé') return { icon: '✓', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-600 dark:text-emerald-400', title: t === 'levé' ? 'Levé / résolu' : 'Réalisé' }
  if (t === 'annulé' || s === 'cancelled') return { icon: '✖', bg: 'bg-muted/40', text: 'text-muted-foreground', title: 'Annulé' }
  if (t === 'aggravé') return { icon: '⚠', bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-600 dark:text-red-400', title: 'Aggravé' }
  if (t === 'réouvert') return { icon: '↩', bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-500 dark:text-red-400', title: 'Réouvert' }
  if (t === 'réapparu') return { icon: '↗', bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-600 dark:text-purple-400', title: 'Réapparu après absence' }
  if (t === 'progressé') return { icon: '●', bg: 'bg-blue-50/60 dark:bg-blue-950/20', text: 'text-blue-500 dark:text-blue-400', title: 'En progression' }
  if (t === 'maintenu') return { icon: '●', bg: 'bg-muted/20', text: 'text-muted-foreground', title: 'Inchangé' }
  return { icon: '~', bg: 'bg-muted/30', text: 'text-muted-foreground', title: 'Changement' }
}

// ── Filtres ───────────────────────────────────────────────────────────────────

type SortKey = 'recent' | 'duration' | 'severity' | 'theme' | 'alpha'
type StatusFilter = 'all' | 'open' | 'alert'

const FAMILY_LABELS: Record<string, string> = {
  observation: 'Obs.',
  reservation: 'Rés.',
  non_conformity: 'NC',
  action: 'Act.',
  decision: 'Déc.',
  knowledge_fact: 'Info',
  deadline: 'Éch.',
}

const SEVERITY_ORDER = ['réouvert', 'aggravé', 'réapparu', 'réalisé', 'levé', 'annulé', 'progressé', 'maintenu', 'changé', null]

function rowSeverity(row: SubjectMatrixRow): number {
  for (const cell of [...row.cells].reverse()) {
    if (cell && !cell.isGap) {
      const idx = SEVERITY_ORDER.indexOf(cell.transition as typeof SEVERITY_ORDER[0])
      return idx >= 0 ? idx : SEVERITY_ORDER.length
    }
  }
  return SEVERITY_ORDER.length
}

function rowLastActiveIndex(row: SubjectMatrixRow): number {
  return row.cells.findLastIndex((c) => c !== null && !c.isGap)
}

function rowDuration(row: SubjectMatrixRow): number {
  const first = row.cells.findIndex((c) => c !== null)
  const last = rowLastActiveIndex(row)
  return last - first
}

// ── Composant principal ───────────────────────────────────────────────────────

interface Props {
  matrix: SiteSubjectMatrix
  siteId: string
  initialThread?: string | null
  initialTheme?: string | null
}

export function SubjectLifelineGrid({ matrix, siteId, initialThread, initialTheme }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [sort, setSort] = useState<SortKey>('recent')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [themeFilter, setThemeFilter] = useState<string>(initialTheme ?? 'all')
  const [hideInfo, setHideInfo] = useState(true)
  const [selectedThread, setSelectedThread] = useState<string | null>(initialThread ?? null)

  const headerRef = useRef<HTMLDivElement>(null)
  const labelColRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Sync selectedThread into URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (selectedThread) params.set('thread', selectedThread)
    else params.delete('thread')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [selectedThread]) // eslint-disable-line react-hooks/exhaustive-deps

  const themes = useMemo(() => {
    const set = new Set<string>()
    for (const row of matrix.rows) {
      if (row.thematicCategory) set.add(row.thematicCategory)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'))
  }, [matrix.rows])

  const filtered = useMemo(() => {
    let rows = matrix.rows

    if (hideInfo) rows = rows.filter((r) => r.family !== 'knowledge_fact')

    if (statusFilter === 'open') {
      rows = rows.filter((r) => {
        const s = r.currentStatus
        return s !== 'done' && s !== 'cancelled' && s !== null
      })
    } else if (statusFilter === 'alert') {
      rows = rows.filter((r) => {
        return r.cells.some((c) => c && !c.isGap && (c.transition === 'aggravé' || c.transition === 'réouvert'))
      })
    }

    if (themeFilter !== 'all') {
      rows = rows.filter((r) => r.thematicCategory === themeFilter)
    }

    const sorted = [...rows]
    if (sort === 'recent') sorted.sort((a, b) => rowLastActiveIndex(b) - rowLastActiveIndex(a))
    else if (sort === 'duration') sorted.sort((a, b) => rowDuration(b) - rowDuration(a))
    else if (sort === 'severity') sorted.sort((a, b) => rowSeverity(a) - rowSeverity(b))
    else if (sort === 'theme') sorted.sort((a, b) => (a.thematicCategory ?? '').localeCompare(b.thematicCategory ?? '', 'fr'))
    else sorted.sort((a, b) => a.canonicalLabel.localeCompare(b.canonicalLabel, 'fr'))

    return sorted
  }, [matrix.rows, sort, statusFilter, themeFilter, hideInfo])

  const runs = matrix.runs
  const CELL_W = 52
  const LABEL_W = 220

  // Sync horizontal scroll between header and body
  function onBodyScroll(e: React.UIEvent<HTMLDivElement>) {
    if (headerRef.current) headerRef.current.scrollLeft = (e.target as HTMLDivElement).scrollLeft
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed p-8 text-center text-sm text-muted-foreground">
        Aucun PV analysé pour ce chantier.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Barre de filtres */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border bg-card px-2.5 py-1.5 text-sm"
        >
          <option value="recent">Trier : activité récente</option>
          <option value="duration">Trier : durée</option>
          <option value="severity">Trier : gravité</option>
          <option value="theme">Trier : thème</option>
          <option value="alpha">Trier : alphabétique</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border bg-card px-2.5 py-1.5 text-sm"
        >
          <option value="all">Tous les sujets</option>
          <option value="open">Encore ouverts</option>
          <option value="alert">Réapparus / aggravés</option>
        </select>

        {themes.length > 0 && (
          <select
            value={themeFilter}
            onChange={(e) => setThemeFilter(e.target.value)}
            className="rounded-lg border bg-card px-2.5 py-1.5 text-sm"
          >
            <option value="all">Tous les thèmes</option>
            {themes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={hideInfo}
            onChange={(e) => setHideInfo(e.target.checked)}
            className="rounded"
          />
          Masquer informationnels
        </label>

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} sujet{filtered.length > 1 ? 's' : ''} · {runs.length} PV
        </span>
      </div>

      {/* Légende */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {[
          { icon: '○', label: 'Apparition', color: 'text-blue-600' },
          { icon: '●', label: 'Maintenu', color: 'text-muted-foreground' },
          { icon: '⚠', label: 'Aggravé', color: 'text-red-600' },
          { icon: '↩', label: 'Réouvert', color: 'text-red-500' },
          { icon: '✓', label: 'Clôturé', color: 'text-emerald-600' },
          { icon: '✖', label: 'Annulé', color: 'text-muted-foreground' },
          { icon: '╌', label: 'Non mentionné', color: 'text-muted-foreground/40' },
        ].map(({ icon, label, color }) => (
          <span key={label} className="flex items-center gap-1">
            <span className={`font-bold ${color}`}>{icon}</span>
            <span>{label}</span>
          </span>
        ))}
      </div>

      {/* Grille avec en-tête et première colonne fixés */}
      <div className="overflow-hidden rounded-xl border bg-card">
        {/* En-tête PV — scroll synchronisé */}
        <div className="flex border-b bg-muted/40">
          {/* Coin fixe */}
          <div className="shrink-0 border-r px-3 py-2" style={{ width: LABEL_W }}>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sujet</span>
          </div>
          {/* Dates PV — scroll */}
          <div ref={headerRef} className="overflow-hidden" style={{ flex: 1 }}>
            <div className="flex" style={{ minWidth: runs.length * CELL_W }}>
              {runs.map((run, i) => (
                <div
                  key={run.id}
                  className="shrink-0 border-r px-1 py-2 text-center last:border-r-0"
                  style={{ width: CELL_W }}
                >
                  <p className="text-[10px] font-semibold text-muted-foreground">PV{i + 1}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {new Date(run.effectiveDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Corps — scroll horizontal partagé */}
        <div className="flex" style={{ maxHeight: '70vh' }}>
          {/* Première colonne fixe */}
          <div ref={labelColRef} className="shrink-0 overflow-y-auto border-r" style={{ width: LABEL_W }}>
            {filtered.map((row) => (
              <div
                key={row.subjectThreadId}
                className={`flex cursor-pointer items-center gap-1.5 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30 ${selectedThread === row.subjectThreadId ? 'bg-muted/50' : ''}`}
                style={{ height: 40 }}
                onClick={() => setSelectedThread(row.subjectThreadId === selectedThread ? null : row.subjectThreadId)}
              >
                <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                  {FAMILY_LABELS[row.family] ?? row.family.slice(0, 4)}
                </span>
                <Link
                  href={`/sites/${siteId}/historique/${row.subjectThreadId}`}
                  className="truncate text-xs font-medium hover:underline"
                  onClick={(e) => e.stopPropagation()}
                  title={row.canonicalLabel}
                >
                  {row.canonicalLabel}
                </Link>
              </div>
            ))}
          </div>

          {/* Cellules — scroll horizontal + vertical */}
          <div
            ref={scrollRef}
            className="overflow-auto"
            style={{ flex: 1 }}
            onScroll={(e) => {
              onBodyScroll(e)
              // Sync vertical with label column
              if (labelColRef.current) labelColRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop
            }}
          >
            <div style={{ minWidth: runs.length * CELL_W }}>
              {filtered.map((row) => (
                <div
                  key={row.subjectThreadId}
                  className={`flex border-b last:border-b-0 ${selectedThread === row.subjectThreadId ? 'ring-1 ring-inset ring-primary/30' : ''}`}
                  style={{ height: 40 }}
                >
                  {row.cells.map((cell, i) => {
                    const style = cellStyle(cell)
                    if (cell === null) {
                      return (
                        <div key={i} className="shrink-0 border-r last:border-r-0" style={{ width: CELL_W }} />
                      )
                    }
                    return (
                      <div
                        key={i}
                        className={`shrink-0 border-r last:border-r-0 ${style.bg} flex items-center justify-center`}
                        style={{ width: CELL_W }}
                        title={[style.title, cell.label].filter(Boolean).join(' · ')}
                      >
                        <span className={`text-base font-bold leading-none ${style.text}`}>{style.icon}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Panneau de détail du sujet sélectionné */}
      {selectedThread && (() => {
        const row = filtered.find((r) => r.subjectThreadId === selectedThread)
        if (!row) return null
        return (
          <div className="rounded-[18px] border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{row.thematicCategory ?? row.family}</p>
                <p className="mt-0.5 font-semibold">{row.canonicalLabel}</p>
              </div>
              <Link
                href={`/sites/${siteId}/historique/${row.subjectThreadId}`}
                className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
              >
                Voir la fiche
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {row.cells.map((cell, i) => {
                if (cell === null || cell.isGap) return null
                const run = runs[i]
                const s = cellStyle(cell)
                return (
                  <span key={i} className={`flex items-center gap-1 ${s.text}`}>
                    <span className="font-bold">{s.icon}</span>
                    <span>PV{i + 1} ({new Date(run.effectiveDate).toLocaleDateString('fr-FR', { month: 'short', day: '2-digit' })})</span>
                    {s.title && <span className="text-muted-foreground">— {s.title}</span>}
                  </span>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Statut actuel : {row.currentStatus ?? 'inconnu'}
              {row.cells.some((c) => c?.isGap) && ' · contient des PV où ce sujet est non mentionné (état conservé)'}
            </p>
          </div>
        )
      })()}
    </div>
  )
}
