'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { ChevronDown, ChevronRight, GitMerge, GripVertical, MoreHorizontal, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { SiteSubjectMatrix, SubjectMatrixRow, MatrixCell } from '@/lib/documents/pv-history'
import { mergeCanonicalSubjectsAction } from './merge-actions'

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

// ── Types et helpers topic ────────────────────────────────────────────────────

interface RowGroup {
  topicId: string | null
  topicLabel: string | null
  rows: SubjectMatrixRow[]
}

type FlatItem =
  | { kind: 'topic'; topicId: string; topicLabel: string; rowCount: number; aggregatePvCells: Array<MatrixCell | null>; topicNativeDates: Set<string> }
  | { kind: 'ungrouped-sep'; count: number }
  | { kind: 'subject'; row: SubjectMatrixRow }

function aggregateTopicPvCells(rows: SubjectMatrixRow[], runCount: number): Array<MatrixCell | null> {
  return Array.from({ length: runCount }, (_, i) => {
    let hasReal = false, hasGap = false
    for (const row of rows) {
      const cell = row.cells[i]
      if (!cell) continue
      if (!cell.isGap) { hasReal = true; break }
      hasGap = true
    }
    if (hasReal) return { status: null, transition: null, isGap: false, proposalId: null, label: null }
    if (hasGap) return { status: null, transition: null, isGap: true, proposalId: null, label: null }
    return null
  })
}

// ── Filtres ───────────────────────────────────────────────────────────────────

type SortKey = 'importance' | 'recent' | 'duration' | 'severity' | 'theme' | 'alpha'
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
  suggestedCounts?: Record<string, number>
  importanceScores?: Record<string, number>
  /** Occurrences terrain (visites + réunions) par canonicalSubjectId — Option B sparkline. */
  nativeOccurrences?: Record<string, Array<{ date: string; sourceKind: 'field_visit' | 'meeting' }>>
  /** Labels des sujets 100% natifs (absents de la matrice PV). */
  nativeSubjectLabels?: Record<string, string>
}

export function SubjectLifelineGrid({ matrix, siteId, initialThread, initialTheme, suggestedCounts, importanceScores, nativeOccurrences, nativeSubjectLabels }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [sort, setSort] = useState<SortKey>('importance')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [themeFilter, setThemeFilter] = useState<string>(initialTheme ?? 'all')
  const [hideInfo, setHideInfo] = useState(true)
  const [selectedThread, setSelectedThread] = useState<string | null>(initialThread ?? null)
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())

  // Fusion manuelle
  const [mergeDialog, setMergeDialog] = useState<{ sourceId: string; sourceLabel: string } | null>(null)
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
  const [mergeSuggestedLabel, setMergeSuggestedLabel] = useState('')
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [isMerging, startMergeTransition] = useTransition()

  function openMergeDialog(sourceId: string, sourceLabel: string) {
    setMergeDialog({ sourceId, sourceLabel })
    setMergeSearch('')
    setMergeTargetId(null)
    setMergeSuggestedLabel('')
    setMergeError(null)
  }

  function closeMergeDialog() {
    setMergeDialog(null)
  }

  function submitMerge() {
    if (!mergeDialog || !mergeTargetId) return
    startMergeTransition(async () => {
      const result = await mergeCanonicalSubjectsAction(
        mergeDialog.sourceId,
        mergeTargetId,
        mergeSuggestedLabel,
        siteId,
      )
      if (result.error) {
        setMergeError(result.error)
      } else {
        closeMergeDialog()
      }
    })
  }

  const mergeCandidates = useMemo(() => {
    if (!mergeDialog) return []
    const q = mergeSearch.toLowerCase()
    return matrix.rows
      .filter((r) => r.canonicalSubjectId && r.canonicalSubjectId !== mergeDialog.sourceId)
      .filter((r) => !q || r.canonicalLabel.toLowerCase().includes(q))
      .slice(0, 15)
  }, [matrix.rows, mergeDialog, mergeSearch])

  function toggleTopic(topicId: string) {
    setExpandedTopics((prev) => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }

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

  const topics = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of matrix.rows) {
      if (row.topicId && row.topicLabel) map.set(row.topicId, row.topicLabel)
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  }, [matrix.rows])

  const filtered = useMemo(() => {
    let rows = matrix.rows

    const HIDE_BY_DEFAULT = new Set(['knowledge_fact', 'person', 'company'])
    if (hideInfo) rows = rows.filter((r) => !HIDE_BY_DEFAULT.has(r.family))

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
      rows = rows.filter((r) => r.topicId === themeFilter)
    }

    const sorted = [...rows]
    if (sort === 'importance') {
      sorted.sort((a, b) => {
        const sa = a.canonicalSubjectId ? (importanceScores?.[a.canonicalSubjectId] ?? 0) : 0
        const sb = b.canonicalSubjectId ? (importanceScores?.[b.canonicalSubjectId] ?? 0) : 0
        return sb - sa
      })
    } else if (sort === 'recent') sorted.sort((a, b) => rowLastActiveIndex(b) - rowLastActiveIndex(a))
    else if (sort === 'duration') sorted.sort((a, b) => rowDuration(b) - rowDuration(a))
    else if (sort === 'severity') sorted.sort((a, b) => rowSeverity(a) - rowSeverity(b))
    else if (sort === 'theme') sorted.sort((a, b) => (a.thematicCategory ?? '').localeCompare(b.thematicCategory ?? '', 'fr'))
    else sorted.sort((a, b) => a.canonicalLabel.localeCompare(b.canonicalLabel, 'fr'))

    return sorted
  }, [matrix.rows, sort, statusFilter, themeFilter, hideInfo, importanceScores])

  const runs = matrix.runs
  const CELL_W = 52
  const [labelWidth, setLabelWidth] = useState(280)
  const resizeDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  // Sujets 100% natifs — canonicalSubjectId présent dans nativeOccurrences mais absent de la matrice PV
  const matrixCanonicalIds = useMemo(
    () => new Set(matrix.rows.map((r) => r.canonicalSubjectId).filter(Boolean)),
    [matrix.rows],
  )

  const nativeOnlySubjects = useMemo(() => {
    if (!nativeOccurrences || !nativeSubjectLabels) return []
    return Object.entries(nativeOccurrences)
      .filter(([csId]) => !matrixCanonicalIds.has(csId))
      .map(([csId, occs]) => ({
        csId,
        label: nativeSubjectLabels[csId] ?? csId,
        occurrences: occs,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  }, [nativeOccurrences, nativeSubjectLabels, matrixCanonicalIds])

  // Groupement par topic + flat list pour le rendu
  const grouped = useMemo((): RowGroup[] => {
    const topicMap = new Map<string, { label: string; rows: SubjectMatrixRow[] }>()
    const ungrouped: SubjectMatrixRow[] = []
    for (const row of filtered) {
      if (row.topicId && row.topicLabel) {
        const g = topicMap.get(row.topicId) ?? { label: row.topicLabel, rows: [] }
        g.rows.push(row)
        topicMap.set(row.topicId, g)
      } else {
        ungrouped.push(row)
      }
    }
    const result: RowGroup[] = []
    for (const [topicId, { label, rows }] of topicMap) {
      result.push({ topicId, topicLabel: label, rows })
    }
    result.sort((a, b) => {
      const latestA = Math.max(-1, ...a.rows.map(rowLastActiveIndex))
      const latestB = Math.max(-1, ...b.rows.map(rowLastActiveIndex))
      if (latestB !== latestA) return latestB - latestA
      return (a.topicLabel ?? '').localeCompare(b.topicLabel ?? '', 'fr')
    })
    if (ungrouped.length > 0) result.push({ topicId: null, topicLabel: null, rows: ungrouped })
    return result
  }, [filtered])

  const flatItems = useMemo((): FlatItem[] => {
    const items: FlatItem[] = []
    const hasTopics = grouped.some((g) => g.topicId !== null)
    for (const group of grouped) {
      if (group.topicId) {
        const aggCells = aggregateTopicPvCells(group.rows, runs.length)
        const topicNativeDates = new Set<string>()
        for (const row of group.rows) {
          if (row.canonicalSubjectId && nativeOccurrences?.[row.canonicalSubjectId]) {
            for (const o of nativeOccurrences[row.canonicalSubjectId]) topicNativeDates.add(o.date)
          }
        }
        items.push({ kind: 'topic', topicId: group.topicId, topicLabel: group.topicLabel!, rowCount: group.rows.length, aggregatePvCells: aggCells, topicNativeDates })
        if (expandedTopics.has(group.topicId)) {
          for (const row of group.rows) items.push({ kind: 'subject', row })
        }
      } else {
        if (hasTopics) items.push({ kind: 'ungrouped-sep', count: group.rows.length })
        for (const row of group.rows) items.push({ kind: 'subject', row })
      }
    }
    return items
  }, [grouped, expandedTopics, runs.length, nativeOccurrences])

  // Dates uniques des événements natifs (visites + réunions)
  const nativeDates = useMemo(() => {
    if (!nativeOccurrences) return []
    const dateMap = new Map<string, { date: string; hasVisit: boolean; hasMeeting: boolean }>()
    for (const occs of Object.values(nativeOccurrences)) {
      for (const o of occs) {
        const existing = dateMap.get(o.date) ?? { date: o.date, hasVisit: false, hasMeeting: false }
        if (o.sourceKind === 'field_visit') existing.hasVisit = true
        else existing.hasMeeting = true
        dateMap.set(o.date, existing)
      }
    }
    return [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [nativeOccurrences])

  // Sync horizontal scroll between header and body
  function onBodyScroll(e: React.UIEvent<HTMLDivElement>) {
    if (headerRef.current) headerRef.current.scrollLeft = (e.target as HTMLDivElement).scrollLeft
  }

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    resizeDragRef.current = { startX: e.clientX, startWidth: labelWidth }
    function onMove(ev: MouseEvent) {
      if (!resizeDragRef.current) return
      const delta = ev.clientX - resizeDragRef.current.startX
      setLabelWidth(Math.max(160, Math.min(480, resizeDragRef.current.startWidth + delta)))
    }
    function onUp() {
      resizeDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed p-8 text-center text-sm text-muted-foreground">
        Aucun PV analysé pour ce chantier.
      </div>
    )
  }

  return (
  <>
    <div className="space-y-3">
      {/* Barre de filtres */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border bg-card px-2.5 py-1.5 text-sm"
        >
          <option value="importance">Trier : importance</option>
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

        {topics.length > 0 && (
          <select
            value={themeFilter}
            onChange={(e) => setThemeFilter(e.target.value)}
            className="rounded-lg border bg-card px-2.5 py-1.5 text-sm"
          >
            <option value="all">Tous les thèmes</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={hideInfo}
            onChange={(e) => setHideInfo(e.target.checked)}
            className="rounded"
          />
          Masquer acteurs et informationnels
        </label>

        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} sujet{filtered.length > 1 ? 's' : ''}
          {grouped.some((g) => g.topicId !== null) && ` · ${grouped.filter((g) => g.topicId !== null).length} thème${grouped.filter((g) => g.topicId !== null).length > 1 ? 's' : ''}`}
          {' · '}{runs.length} PV
          {nativeDates.length > 0 && ` · ${nativeDates.length} événement${nativeDates.length > 1 ? 's' : ''} terrain`}
        </span>
      </div>

      {/* Légende */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {[
          { icon: '○', label: 'Apparition PV', color: 'text-blue-600' },
          { icon: '●', label: 'Maintenu PV', color: 'text-muted-foreground' },
          { icon: '⚠', label: 'Aggravé', color: 'text-red-600' },
          { icon: '↩', label: 'Réouvert', color: 'text-red-500' },
          { icon: '✓', label: 'Clôturé PV', color: 'text-emerald-600' },
          { icon: '✖', label: 'Annulé', color: 'text-muted-foreground' },
          { icon: '╌', label: 'Non mentionné', color: 'text-muted-foreground/40' },
          { icon: '✓', label: 'Visite terrain', color: 'text-teal-600' },
          { icon: '◇', label: 'Réunion', color: 'text-violet-600' },
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
          {/* Coin fixe + poignée de resize */}
          <div className="relative shrink-0 border-r px-3 py-2" style={{ width: labelWidth }}>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sujet</span>
            <div
              onMouseDown={onResizeMouseDown}
              className="absolute right-0 top-0 flex h-full w-4 cursor-col-resize items-center justify-center text-muted-foreground/40 hover:bg-primary/10 hover:text-muted-foreground"
              title="Glisser pour redimensionner"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </div>
          </div>
          {/* Dates PV + événements natifs — scroll */}
          <div ref={headerRef} className="overflow-hidden" style={{ flex: 1 }}>
            <div className="flex" style={{ minWidth: (runs.length + nativeDates.length) * CELL_W }}>
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
              {nativeDates.map((nd) => (
                <div
                  key={nd.date}
                  className="shrink-0 border-l-2 border-r border-teal-200/60 dark:border-teal-700/40 bg-teal-50/40 dark:bg-teal-950/20 px-1 py-2 text-center last:border-r-0"
                  style={{ width: CELL_W }}
                >
                  <p className={`text-[10px] font-semibold ${nd.hasVisit ? 'text-teal-600 dark:text-teal-400' : 'text-violet-600 dark:text-violet-400'}`}>
                    {nd.hasVisit ? '✓' : '◇'}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    {new Date(nd.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Corps — scroll horizontal partagé */}
        <div className="flex" style={{ maxHeight: '70vh' }}>
          {/* Première colonne fixe */}
          <div ref={labelColRef} className="shrink-0 overflow-y-auto border-r" style={{ width: labelWidth }}>
            {flatItems.map((item, idx) => {
              if (item.kind === 'topic') {
                return (
                  <button
                    key={`topic-${item.topicId}`}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-1.5 border-b border-l-2 border-l-primary/20 px-3 py-2 last:border-b-0 bg-muted/40 hover:bg-muted/50 dark:bg-muted/20"
                    style={{ height: 40 }}
                    onClick={() => toggleTopic(item.topicId)}
                  >
                    {expandedTopics.has(item.topicId)
                      ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground/80" title={item.topicLabel}>
                      {item.topicLabel}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                      {item.rowCount}
                    </span>
                  </button>
                )
              }
              if (item.kind === 'ungrouped-sep') {
                return (
                  <div
                    key="ungrouped-sep"
                    className="flex items-center gap-2 border-b border-t bg-muted/5 px-3 last:border-b-0"
                    style={{ height: 40 }}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Autres sujets ({item.count})
                    </span>
                  </div>
                )
              }
              const row = item.row
              return (
                <div
                  key={row.subjectThreadId}
                  className={`group flex cursor-pointer items-center gap-1.5 border-b px-3 py-2 last:border-b-0 hover:bg-muted/30 ${selectedThread === row.subjectThreadId ? 'bg-muted/50' : ''}`}
                  style={{ height: 40 }}
                  onClick={() => setSelectedThread(row.subjectThreadId === selectedThread ? null : row.subjectThreadId)}
                >
                  <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                    {FAMILY_LABELS[row.family] ?? row.family.slice(0, 4)}
                  </span>
                  <Link
                    href={row.canonicalSubjectId
                      ? `/sites/${siteId}/historique/sujets/${row.canonicalSubjectId}`
                      : `/sites/${siteId}/historique/${row.subjectThreadId}`}
                    className="min-w-0 flex-1 truncate text-xs font-medium hover:underline"
                    onClick={(e) => e.stopPropagation()}
                    title={row.canonicalLabel}
                  >
                    {row.canonicalLabel}
                  </Link>
                  {row.canonicalSubjectId && (suggestedCounts?.[row.canonicalSubjectId] ?? 0) > 0 && (
                    <Link
                      href={`/sites/${siteId}/historique/sujets/${row.canonicalSubjectId}#relations`}
                      onClick={(e) => e.stopPropagation()}
                      title="Suggestions de dépendances à valider"
                      className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300"
                    >
                      {suggestedCounts![row.canonicalSubjectId]}
                    </Link>
                  )}
                  {row.canonicalSubjectId && nativeOccurrences?.[row.canonicalSubjectId]?.length ? (
                    <span
                      title={`${nativeOccurrences[row.canonicalSubjectId].length} observation${nativeOccurrences[row.canonicalSubjectId].length > 1 ? 's' : ''} terrain`}
                      className="shrink-0 flex items-center gap-0.5"
                    >
                      {nativeOccurrences[row.canonicalSubjectId].slice(0, 3).map((o, i) => (
                        <span
                          key={i}
                          className={o.sourceKind === 'field_visit'
                            ? 'h-1.5 w-1.5 rounded-full bg-teal-500'
                            : 'h-1.5 w-1.5 rotate-45 bg-violet-500 inline-block'}
                        />
                      ))}
                      {nativeOccurrences[row.canonicalSubjectId].length > 3 && (
                        <span className="text-[8px] text-muted-foreground leading-none">+{nativeOccurrences[row.canonicalSubjectId].length - 3}</span>
                      )}
                    </span>
                  ) : null}
                  {row.canonicalSubjectId && (
                    <button
                      type="button"
                      title="Fusionner avec…"
                      onClick={(e) => { e.stopPropagation(); openMergeDialog(row.canonicalSubjectId!, row.canonicalLabel) }}
                      className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-opacity"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
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
            <div style={{ minWidth: (runs.length + nativeDates.length) * CELL_W }}>
              {flatItems.map((item) => {
                if (item.kind === 'topic') {
                  return (
                    <div
                      key={`topic-${item.topicId}`}
                      className="flex border-b last:border-b-0 bg-muted/40 dark:bg-muted/20"
                      style={{ height: 40 }}
                    >
                      {item.aggregatePvCells.map((cell, i) => {
                        if (cell === null) {
                          return <div key={i} className="shrink-0 border-r last:border-r-0" style={{ width: CELL_W }} />
                        }
                        if (cell.isGap) {
                          return (
                            <div key={i} className="shrink-0 border-r last:border-r-0 bg-muted/20 flex items-center justify-center" style={{ width: CELL_W }}>
                              <span className="text-base font-bold text-muted-foreground/30">╌</span>
                            </div>
                          )
                        }
                        return (
                          <div key={i} className="shrink-0 border-r last:border-r-0 bg-primary/5 flex items-center justify-center" style={{ width: CELL_W }}>
                            <span className="text-base font-bold text-primary/40">●</span>
                          </div>
                        )
                      })}
                      {nativeDates.map((nd) => {
                        const hasOcc = item.topicNativeDates.has(nd.date)
                        if (!hasOcc) {
                          return (
                            <div key={nd.date} className="shrink-0 border-l-2 border-r border-teal-200/40 dark:border-teal-700/30 bg-teal-50/10 dark:bg-teal-950/10 last:border-r-0" style={{ width: CELL_W }} />
                          )
                        }
                        return (
                          <div key={nd.date} className="shrink-0 border-l-2 border-r last:border-r-0 border-teal-300/60 dark:border-teal-600/40 bg-teal-50/30 dark:bg-teal-950/20 flex items-center justify-center" style={{ width: CELL_W }}>
                            <span className="text-sm font-bold text-teal-600/50 dark:text-teal-400/50">▪</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                }
                if (item.kind === 'ungrouped-sep') {
                  return (
                    <div
                      key="ungrouped-sep"
                      className="flex border-b border-t bg-muted/5 last:border-b-0"
                      style={{ height: 40, minWidth: (runs.length + nativeDates.length) * CELL_W }}
                    />
                  )
                }
                const row = item.row
                return (
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
                    {nativeDates.map((nd) => {
                      const rowOccs = row.canonicalSubjectId ? (nativeOccurrences?.[row.canonicalSubjectId] ?? []) : []
                      const occ = rowOccs.find((o) => o.date === nd.date)
                      if (!occ) {
                        return (
                          <div key={nd.date} className="shrink-0 border-l-2 border-r border-teal-200/40 dark:border-teal-700/30 bg-teal-50/10 dark:bg-teal-950/10 last:border-r-0" style={{ width: CELL_W }} />
                        )
                      }
                      return (
                        <div
                          key={nd.date}
                          className={`shrink-0 border-l-2 border-r last:border-r-0 flex items-center justify-center ${
                            occ.sourceKind === 'field_visit'
                              ? 'border-teal-300/60 dark:border-teal-600/40 bg-teal-50 dark:bg-teal-950/40'
                              : 'border-violet-300/60 dark:border-violet-600/40 bg-violet-50 dark:bg-violet-950/40'
                          }`}
                          style={{ width: CELL_W }}
                          title={occ.sourceKind === 'field_visit' ? 'Visite terrain' : 'Réunion'}
                        >
                          <span className={`text-sm font-bold leading-none ${
                            occ.sourceKind === 'field_visit'
                              ? 'text-teal-600 dark:text-teal-400'
                              : 'text-violet-600 dark:text-violet-400'
                          }`}>
                            {occ.sourceKind === 'field_visit' ? '✓' : '◇'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Sujets nés dans MemorIA — canonical subjects sans aucun PV */}
      {nativeOnlySubjects.length > 0 && (
        <section className="rounded-[22px] border bg-card p-5 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sujets nés dans MemorIA
          </p>
          <div className="divide-y">
            {nativeOnlySubjects.map(({ csId, label, occurrences }) => (
              <div key={csId} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
                <Link
                  href={`/sites/${siteId}/historique/sujets/${csId}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {label}
                </Link>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {occurrences.map((o, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        o.sourceKind === 'field_visit'
                          ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
                          : 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
                      }`}
                    >
                      <span>{o.sourceKind === 'field_visit' ? '✓' : '◇'}</span>
                      <span>{new Date(o.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
                      <span className="opacity-70">{o.sourceKind === 'field_visit' ? 'Visite' : 'Réunion'}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
                href={row.canonicalSubjectId
                  ? `/sites/${siteId}/historique/sujets/${row.canonicalSubjectId}`
                  : `/sites/${siteId}/historique/${row.subjectThreadId}`}
                className="shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
              >
                Voir la vie du sujet
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

    {/* Dialog de fusion */}
    {mergeDialog && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        onClick={closeMergeDialog}
      >
        <div
          className="relative w-full max-w-md rounded-2xl bg-card p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <GitMerge className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fusionner avec…</p>
              </div>
              <p className="font-semibold leading-snug">{mergeDialog.sourceLabel}</p>
            </div>
            <button
              type="button"
              onClick={closeMergeDialog}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground mb-2">
            Choisir la formulation principale (winner déterminé automatiquement par le nombre de threads) :
          </p>

          <input
            type="text"
            placeholder="Rechercher un sujet…"
            value={mergeSearch}
            onChange={(e) => { setMergeSearch(e.target.value); setMergeTargetId(null) }}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 mb-2"
            autoFocus
          />

          {mergeCandidates.length > 0 ? (
            <ul className="max-h-48 overflow-y-auto rounded-lg border divide-y mb-4">
              {mergeCandidates.map((r) => (
                <li key={r.canonicalSubjectId}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors ${mergeTargetId === r.canonicalSubjectId ? 'bg-primary/10 font-medium' : ''}`}
                    onClick={() => { setMergeTargetId(r.canonicalSubjectId!); setMergeSuggestedLabel('') }}
                  >
                    <span className="block truncate">{r.canonicalLabel}</span>
                    {r.topicLabel && (
                      <span className="text-[10px] text-muted-foreground">{r.topicLabel}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground mb-4 py-2 text-center">
              {mergeSearch ? 'Aucun résultat' : 'Tapez pour rechercher'}
            </p>
          )}

          {mergeTargetId && (
            <div className="mb-4">
              <label className="block text-xs text-muted-foreground mb-1">
                Libellé canonique final <span className="opacity-60">(facultatif — si vide, le libellé du winner est conservé)</span>
              </label>
              <input
                type="text"
                value={mergeSuggestedLabel}
                onChange={(e) => setMergeSuggestedLabel(e.target.value)}
                placeholder="Laisser vide pour conserver le libellé du winner"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}

          {mergeError && (
            <p className="text-sm text-destructive mb-3">{mergeError}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={closeMergeDialog}
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={!mergeTargetId || isMerging}
              onClick={submitMerge}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {isMerging ? 'Fusion…' : 'Fusionner'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  )
}
