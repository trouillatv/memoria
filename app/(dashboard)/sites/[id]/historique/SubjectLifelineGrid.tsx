'use client'

import { useState, useMemo, useRef, useEffect, useTransition } from 'react'
import { ChevronDown, ChevronRight, GitMerge, GripVertical, MoreHorizontal, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  DndContext, DragOverlay, useDroppable, useDraggable,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { SiteSubjectMatrix, SubjectMatrixRow, MatrixCell } from '@/lib/documents/pv-history'
import { mergeCanonicalSubjectsAction, moveSubjectToTopicAction, createLinkFromMatrixAction, analyzeSubjectSimilarityAction } from './merge-actions'
import type { SubjectSimilarity } from './merge-actions'

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
  native: '',
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

// ── Composants DnD ───────────────────────────────────────────────────────────

type NativeDate = { date: string; hasVisit: boolean; hasMeeting: boolean }
type NativeOcc = { date: string; sourceKind: 'field_visit' | 'meeting' }
type TopicFlatItem = Extract<FlatItem, { kind: 'topic' }>

function DroppableTopicRow({
  item, labelWidth, CELL_W, nativeDates, isExpanded, onToggle,
}: {
  item: TopicFlatItem
  labelWidth: number
  CELL_W: number
  nativeDates: NativeDate[]
  isExpanded: boolean
  onToggle: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `topic:${item.topicId}`,
    data: { kind: 'topic', id: item.topicId, label: item.topicLabel },
  })

  return (
    <div
      ref={setNodeRef}
      className={`flex border-b transition-colors ${isOver ? 'bg-primary/10 dark:bg-primary/10 outline outline-2 outline-primary/30 outline-offset-[-1px]' : 'bg-muted/40 dark:bg-muted/20'}`}
      style={{ height: 40 }}
    >
      <div
        className="sticky left-0 z-10 shrink-0 border-l-2 border-l-primary/20 border-r bg-muted/40 dark:bg-muted/20"
        style={{ width: labelWidth }}
      >
        <button
          type="button"
          className="flex h-full w-full cursor-pointer items-center gap-1.5 px-3 hover:bg-muted/50"
          onClick={onToggle}
        >
          {isExpanded
            ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground/80" title={item.topicLabel}>
            {item.topicLabel}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
            {item.rowCount}
          </span>
        </button>
      </div>
      <div className="flex">
        {item.aggregatePvCells.map((cell, i) => {
          if (cell === null) return <div key={i} className="shrink-0 border-r last:border-r-0" style={{ width: CELL_W }} />
          if (cell.isGap) return (
            <div key={i} className="shrink-0 border-r last:border-r-0 bg-muted/20 flex items-center justify-center" style={{ width: CELL_W }}>
              <span className="text-base font-bold text-muted-foreground/30">╌</span>
            </div>
          )
          return (
            <div key={i} className="shrink-0 border-r last:border-r-0 bg-primary/5 flex items-center justify-center" style={{ width: CELL_W }}>
              <span className="text-base font-bold text-primary/40">●</span>
            </div>
          )
        })}
        {nativeDates.map((nd) => {
          const hasOcc = item.topicNativeDates.has(nd.date)
          if (!hasOcc) return <div key={nd.date} className="shrink-0 border-l-2 border-r border-teal-200/40 dark:border-teal-700/30 bg-teal-50/10 dark:bg-teal-950/10 last:border-r-0" style={{ width: CELL_W }} />
          return (
            <div key={nd.date} className="shrink-0 border-l-2 border-r last:border-r-0 border-teal-300/60 dark:border-teal-600/40 bg-teal-50/30 dark:bg-teal-950/20 flex items-center justify-center" style={{ width: CELL_W }}>
              <span className="text-sm font-bold text-teal-600/50 dark:text-teal-400/50">▪</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DraggableSubjectRow({
  row, siteId, isSelected, labelWidth, CELL_W, nativeDates,
  nativeOccurrences, suggestedCounts, nativeOnlyIds, onSelect, onMergeDialog,
}: {
  row: SubjectMatrixRow
  siteId: string
  isSelected: boolean
  labelWidth: number
  CELL_W: number
  nativeDates: NativeDate[]
  nativeOccurrences?: Record<string, NativeOcc[]>
  suggestedCounts?: Record<string, number>
  nativeOnlyIds?: Set<string>
  onSelect: () => void
  onMergeDialog: (id: string, label: string) => void
}) {
  const dragId = `subject:${row.canonicalSubjectId ?? row.subjectThreadId}`
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dragId,
    disabled: !row.canonicalSubjectId,
    data: { kind: 'subject', id: row.canonicalSubjectId, label: row.canonicalLabel, currentTopicId: row.topicId ?? null },
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dragId,
    disabled: !row.canonicalSubjectId,
    data: { kind: 'subject', id: row.canonicalSubjectId, label: row.canonicalLabel, currentTopicId: row.topicId ?? null },
  })

  return (
    <div
      ref={setDropRef}
      className={`flex border-b last:border-b-0 ${isSelected ? 'ring-1 ring-inset ring-primary/30' : ''} ${isOver ? 'outline outline-2 outline-blue-400/60 outline-offset-[-1px]' : ''} ${isDragging ? 'opacity-40' : ''}`}
      style={{ height: 40 }}
      onClick={onSelect}
    >
      {/* Label sticky left — toute la zone est draggable */}
      <div
        ref={setDragRef}
        {...attributes}
        {...listeners}
        className={`group sticky left-0 z-10 shrink-0 border-r flex items-center gap-1 px-2 py-2 transition-colors ${row.canonicalSubjectId ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer'} ${isSelected ? 'bg-muted/50' : 'bg-card hover:bg-muted/30'}`}
        style={{ width: labelWidth }}
        title={row.canonicalSubjectId ? 'Glisser pour fusionner, relier ou déplacer' : undefined}
      >
        {/* Indice visuel de draggabilité */}
        {row.canonicalSubjectId && (
          <GripVertical className="hidden sm:block shrink-0 h-3 w-3 text-muted-foreground/25 group-hover:text-muted-foreground/60 transition-colors" />
        )}
        <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
          {FAMILY_LABELS[row.family] ?? row.family.slice(0, 4)}
        </span>
        <Link
          href={row.canonicalSubjectId
            ? `/sites/${siteId}/historique/sujets/${row.canonicalSubjectId}`
            : `/sites/${siteId}/historique/${row.subjectThreadId}`}
          draggable={false}
          className="min-w-0 flex-1 truncate text-xs font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
          title={row.canonicalLabel}
        >
          {row.canonicalLabel}
        </Link>
        {row.canonicalSubjectId && nativeOnlyIds?.has(row.canonicalSubjectId) && (
          <span
            title="Créé dans MemorIA (pas encore dans un PV)"
            className="shrink-0 text-[10px] text-violet-500 dark:text-violet-400 leading-none"
          >
            ✦
          </span>
        )}
        {row.canonicalSubjectId && (suggestedCounts?.[row.canonicalSubjectId] ?? 0) > 0 && (
          <Link
            href={`/sites/${siteId}/historique/sujets/${row.canonicalSubjectId}#relations`}
            draggable={false}
            onPointerDown={(e) => e.stopPropagation()}
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
              <span key={i} className={o.sourceKind === 'field_visit' ? 'h-1.5 w-1.5 rounded-full bg-teal-500' : 'h-1.5 w-1.5 rotate-45 bg-violet-500 inline-block'} />
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
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onMergeDialog(row.canonicalSubjectId!, row.canonicalLabel) }}
            className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-opacity"
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
        )}
      </div>
      {/* Cellules */}
      <div className="flex">
        {row.cells.map((cell, i) => {
          const style = cellStyle(cell)
          if (cell === null) return <div key={i} className="shrink-0 border-r last:border-r-0" style={{ width: CELL_W }} />
          return (
            <div key={i} className={`shrink-0 border-r last:border-r-0 ${style.bg} flex items-center justify-center`} style={{ width: CELL_W }} title={[style.title, cell.label].filter(Boolean).join(' · ')}>
              <span className={`text-base font-bold leading-none ${style.text}`}>{style.icon}</span>
            </div>
          )
        })}
        {nativeDates.map((nd) => {
          const rowOccs = row.canonicalSubjectId ? (nativeOccurrences?.[row.canonicalSubjectId] ?? []) : []
          const occ = rowOccs.find((o) => o.date === nd.date)
          if (!occ) return <div key={nd.date} className="shrink-0 border-l-2 border-r border-teal-200/40 dark:border-teal-700/30 bg-teal-50/10 dark:bg-teal-950/10 last:border-r-0" style={{ width: CELL_W }} />
          return (
            <div key={nd.date} className={`shrink-0 border-l-2 border-r last:border-r-0 flex items-center justify-center ${occ.sourceKind === 'field_visit' ? 'border-teal-300/60 dark:border-teal-600/40 bg-teal-50 dark:bg-teal-950/40' : 'border-violet-300/60 dark:border-violet-600/40 bg-violet-50 dark:bg-violet-950/40'}`} style={{ width: CELL_W }} title={occ.sourceKind === 'field_visit' ? 'Visite terrain' : 'Réunion'}>
              <span className={`text-sm font-bold leading-none ${occ.sourceKind === 'field_visit' ? 'text-teal-600 dark:text-teal-400' : 'text-violet-600 dark:text-violet-400'}`}>
                {occ.sourceKind === 'field_visit' ? '✓' : '◇'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
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

  // DnD
  const [activeDragLabel, setActiveDragLabel] = useState<string | null>(null)
  const [intentDialog, setIntentDialog] = useState<{
    kind: 'subject-on-subject'
    sourceId: string; sourceLabel: string; targetId: string; targetLabel: string
  } | {
    kind: 'subject-on-topic'
    sourceId: string; sourceLabel: string; targetTopicId: string; targetTopicLabel: string
  } | null>(null)
  const [linkStep, setLinkStep] = useState(false)
  const [linkType, setLinkType] = useState('requires')
  const [linkInverted, setLinkInverted] = useState(false)
  const [intentIsPending, startIntentTransition] = useTransition()
  const [intentError, setIntentError] = useState<string | null>(null)
  const [similarity, setSimilarity] = useState<{ status: 'loading' } | ({ status: 'done' } & SubjectSimilarity) | { status: 'error'; errorMsg?: string } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

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

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { kind: string; id: string; label: string } | undefined
    setActiveDragLabel(data?.label ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragLabel(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const src = active.data.current as { kind: string; id: string; label: string } | undefined
    const dst = over.data.current as { kind: string; id: string; label: string } | undefined
    if (!src || !dst) return
    if (src.kind === 'subject' && dst.kind === 'subject' && src.id && dst.id) {
      setIntentDialog({
        kind: 'subject-on-subject',
        sourceId: src.id, sourceLabel: src.label,
        targetId: dst.id, targetLabel: dst.label,
      })
      setLinkStep(false)
      setLinkType('requires')
      setLinkInverted(false)
      setIntentError(null)
      setSimilarity({ status: 'loading' })
      analyzeSubjectSimilarityAction(src.id, dst.id).then((result) => {
        if (result.error || result.score === undefined) {
          setSimilarity({ status: 'error', errorMsg: result.error })
        } else {
          setSimilarity({
            status: 'done',
            score: result.score,
            recommendation: result.recommendation!,
            reason: result.reason!,
            suggested_label: result.suggested_label ?? null,
          })
        }
      })
    } else if (src.kind === 'subject' && dst.kind === 'topic' && src.id && dst.id) {
      const srcData = event.active.data.current as { currentTopicId?: string | null }
      if (srcData.currentTopicId === dst.id) return
      setIntentDialog({
        kind: 'subject-on-topic',
        sourceId: src.id, sourceLabel: src.label,
        targetTopicId: dst.id, targetTopicLabel: dst.label,
      })
      setIntentError(null)
    }
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

  const scrollRef = useRef<HTMLDivElement>(null)

  // Sync selectedThread into URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (selectedThread) params.set('thread', selectedThread)
    else params.delete('thread')
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [selectedThread]) // eslint-disable-line react-hooks/exhaustive-deps

  const runs = matrix.runs
  const CELL_W = 52
  const [labelWidth, setLabelWidth] = useState(280)
  const resizeDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const topics = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of matrix.rows) {
      if (row.topicId && row.topicLabel) map.set(row.topicId, row.topicLabel)
    }
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  }, [matrix.rows])

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

  // IDs des sujets 100% natifs (pour badge ✦)
  const nativeOnlyIds = useMemo(
    () => new Set(nativeOnlySubjects.map((s) => s.csId)),
    [nativeOnlySubjects],
  )

  // Fusion : rows PV + rows synthétiques pour les sujets 100% natifs
  const allRows = useMemo((): SubjectMatrixRow[] => {
    const nativeRows: SubjectMatrixRow[] = nativeOnlySubjects.map(({ csId, label }) => ({
      subjectThreadId: `native:${csId}`,
      canonicalLabel: label,
      family: 'native',
      thematicCategory: null,
      currentStatus: null,
      canonicalSubjectId: csId,
      cells: Array(runs.length).fill(null) as Array<MatrixCell | null>,
      topicId: null,
      topicLabel: null,
    }))
    return [...matrix.rows, ...nativeRows]
  }, [matrix.rows, nativeOnlySubjects, runs.length])

  const filtered = useMemo(() => {
    let rows = allRows

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
  }, [allRows, sort, statusFilter, themeFilter, hideInfo, importanceScores])

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

      {/* Grille — scroll unique (horizontal + vertical), header et colonne sticky */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div
        ref={scrollRef}
        className="overflow-auto rounded-xl border bg-card"
        style={{ maxHeight: '70vh' }}
      >
        {/* Feuille unifiée — la largeur minimale force le scroll horizontal */}
        <div style={{ minWidth: labelWidth + (runs.length + nativeDates.length) * CELL_W }}>

          {/* En-tête sticky top */}
          <div className="sticky top-0 z-10 flex border-b bg-muted/40">
            {/* Coin — sticky left ET top */}
            <div
              className="relative sticky left-0 z-20 shrink-0 border-r bg-muted/40 px-3 py-2"
              style={{ width: labelWidth }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sujet</span>
              <div
                onMouseDown={onResizeMouseDown}
                className="absolute right-0 top-0 flex h-full w-4 cursor-col-resize items-center justify-center text-muted-foreground/40 hover:bg-primary/10 hover:text-muted-foreground"
                title="Glisser pour redimensionner"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </div>
            </div>
            {/* Dates PV + événements natifs */}
            <div className="flex">
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

          {/* Lignes du corps — label sticky left + cellules */}
          {flatItems.map((item) => {
            if (item.kind === 'topic') {
              return (
                <DroppableTopicRow
                  key={`topic-${item.topicId}`}
                  item={item}
                  labelWidth={labelWidth}
                  CELL_W={CELL_W}
                  nativeDates={nativeDates}
                  isExpanded={expandedTopics.has(item.topicId)}
                  onToggle={() => toggleTopic(item.topicId)}
                />
              )
            }

            if (item.kind === 'ungrouped-sep') {
              return (
                <div
                  key="ungrouped-sep"
                  className="flex border-b border-t bg-muted/5"
                  style={{ height: 40 }}
                >
                  <div
                    className="sticky left-0 z-10 shrink-0 border-r bg-muted/5 px-3 flex items-center"
                    style={{ width: labelWidth }}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Autres sujets ({item.count})
                    </span>
                  </div>
                  <div style={{ flex: 1 }} />
                </div>
              )
            }

            const row = item.row
            const isSelected = selectedThread === row.subjectThreadId
            return (
              <DraggableSubjectRow
                key={row.subjectThreadId}
                row={row}
                siteId={siteId}
                isSelected={isSelected}
                labelWidth={labelWidth}
                CELL_W={CELL_W}
                nativeDates={nativeDates}
                nativeOccurrences={nativeOccurrences}
                suggestedCounts={suggestedCounts}
                nativeOnlyIds={nativeOnlyIds}
                onSelect={() => setSelectedThread(row.subjectThreadId === selectedThread ? null : row.subjectThreadId)}
                onMergeDialog={openMergeDialog}
              />
            )
          })}
        </div>
      </div>
      <DragOverlay>
        {activeDragLabel && (
          <div className="rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-lg opacity-90 max-w-[220px] truncate">
            {activeDragLabel}
          </div>
        )}
      </DragOverlay>
      </DndContext>


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

    {/* Dialog d'intention DnD — sujet sur sujet */}
    {intentDialog?.kind === 'subject-on-subject' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => { setIntentDialog(null); setSimilarity(null) }}>
        <div className="relative w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
          {!linkStep ? (
            <>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rapprochement de sujets</p>
              <p className="mb-4 leading-snug text-sm">
                <span className="font-semibold text-primary">{intentDialog.sourceLabel}</span>
                <span className="mx-2 text-muted-foreground">→</span>
                <span className="font-medium">{intentDialog.targetLabel}</span>
              </p>

              {/* Bloc analyse Gemini */}
              {(() => {
                if (!similarity || similarity.status === 'loading') {
                  return (
                    <div className="mb-4 flex items-center gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Analyse du rapprochement…
                    </div>
                  )
                }
                if (similarity.status === 'error') {
                  return (
                    <div className="mb-4 rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                      Analyse IA indisponible — choisissez manuellement.
                      {process.env.NODE_ENV !== 'production' && similarity.errorMsg && (
                        <p className="mt-1 font-mono text-[10px] text-destructive break-all">{similarity.errorMsg}</p>
                      )}
                    </div>
                  )
                }
                const { score, reason, suggested_label } = similarity
                const band = score >= 85
                  ? { icon: '🟢', label: 'Très forte correspondance', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-300' }
                  : score >= 65
                    ? { icon: '🟡', label: 'Similarité notable — vérifier', cls: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800/40 dark:text-amber-300' }
                    : { icon: '🔵', label: 'Sujets probablement distincts', cls: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/40 dark:border-blue-800/40 dark:text-blue-300' }
                return (
                  <div className={`mb-4 rounded-xl border px-4 py-3 ${band.cls}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold">{band.icon} Similarité IA {score} %</span>
                      <span className="text-xs opacity-70">{band.label}</span>
                    </div>
                    {reason && <p className="text-xs opacity-80 leading-snug">"{reason}"</p>}
                    {suggested_label && (
                      <p className="mt-1.5 text-xs opacity-70">
                        Libellé suggéré : <span className="font-medium">{suggested_label}</span>
                      </p>
                    )}
                  </div>
                )
              })()}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    openMergeDialog(intentDialog.sourceId, intentDialog.sourceLabel)
                    if (similarity?.status === 'done' && similarity.suggested_label) {
                      setMergeSuggestedLabel(similarity.suggested_label)
                    }
                    setIntentDialog(null)
                    setSimilarity(null)
                  }}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                    similarity?.status === 'done' && similarity.recommendation === 'merge'
                      ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/40'
                      : 'hover:bg-muted'
                  }`}
                >
                  <GitMerge className={`h-4 w-4 shrink-0 ${similarity?.status === 'done' && similarity.recommendation === 'merge' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="font-medium">
                      Fusionner ces deux sujets
                      {similarity?.status === 'done' && similarity.recommendation === 'merge' && (
                        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">recommandé</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">Regrouper sous un seul identifiant canonique</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setLinkStep(true)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                    similarity?.status === 'done' && similarity.recommendation === 'link'
                      ? 'border-blue-300 bg-blue-50 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:hover:bg-blue-900/40'
                      : 'hover:bg-muted'
                  }`}
                >
                  <span className={`h-4 w-4 text-center text-lg leading-none shrink-0 ${similarity?.status === 'done' && similarity.recommendation === 'link' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>→</span>
                  <div>
                    <p className="font-medium">
                      Créer une dépendance
                      {similarity?.status === 'done' && similarity.recommendation === 'link' && (
                        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">recommandé</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">Relier les deux sujets par un lien typé</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => { setIntentDialog(null); setSimilarity(null) }}
                  className="rounded-xl border px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Annuler
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type de dépendance</p>
              <p className="mb-4 text-sm leading-snug">
                {linkInverted
                  ? <><span>{intentDialog.targetLabel}</span>{' '}<span className="font-semibold text-primary">[lien]</span>{' '}<span>{intentDialog.sourceLabel}</span></>
                  : <><span className="text-primary">{intentDialog.sourceLabel}</span>{' '}<span className="font-semibold text-primary">[lien]</span>{' '}<span>{intentDialog.targetLabel}</span></>}
              </p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { value: 'requires', label: 'nécessite' },
                  { value: 'enables', label: 'permet' },
                  { value: 'causes', label: 'entraîne' },
                  { value: 'validates', label: 'valide' },
                  { value: 'replaces', label: 'remplace' },
                  { value: 'related_to', label: 'est lié à' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLinkType(value)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${linkType === value ? 'bg-primary/10 border-primary/30 font-medium text-primary' : 'hover:bg-muted'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setLinkInverted((v) => !v)}
                className="w-full rounded-lg border px-3 py-2 text-sm hover:bg-muted transition-colors mb-4"
              >
                ⇄ Inverser le sens
              </button>
              {intentError && <p className="text-sm text-destructive mb-3">{intentError}</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setLinkStep(false)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                  Retour
                </button>
                <button
                  type="button"
                  disabled={intentIsPending}
                  onClick={() => {
                    if (!intentDialog || intentDialog.kind !== 'subject-on-subject') return
                    const fromId = linkInverted ? intentDialog.targetId : intentDialog.sourceId
                    const toId = linkInverted ? intentDialog.sourceId : intentDialog.targetId
                    startIntentTransition(async () => {
                      const result = await createLinkFromMatrixAction(fromId, toId, linkType, siteId)
                      if (result.error) setIntentError(result.error)
                      else { setIntentDialog(null); setSimilarity(null) }
                    })
                  }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  {intentIsPending ? 'Création…' : 'Créer le lien'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )}

    {/* Dialog d'intention DnD — sujet sur topic */}
    {intentDialog?.kind === 'subject-on-topic' && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setIntentDialog(null)}>
        <div className="relative w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Déplacer vers un thème</p>
          <p className="mb-4 font-medium leading-snug">
            Déplacer <span className="font-semibold text-primary">{intentDialog.sourceLabel}</span> vers <span className="font-semibold">{intentDialog.targetTopicLabel}</span>&nbsp;?
          </p>
          {intentError && <p className="text-sm text-destructive mb-3">{intentError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setIntentDialog(null)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted transition-colors">
              Annuler
            </button>
            <button
              type="button"
              disabled={intentIsPending}
              onClick={() => {
                if (!intentDialog || intentDialog.kind !== 'subject-on-topic') return
                startIntentTransition(async () => {
                  const result = await moveSubjectToTopicAction(intentDialog.sourceId, intentDialog.targetTopicId, siteId)
                  if (result.error) setIntentError(result.error)
                  else setIntentDialog(null)
                })
              }}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {intentIsPending ? 'Déplacement…' : 'Déplacer'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  )
}
