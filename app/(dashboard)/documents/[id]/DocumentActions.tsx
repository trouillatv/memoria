'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { relaunchDocumentAnalysisAction, deleteDocumentAction } from '../actions'
import { AiCostHint } from '../AiCostHint'

const IN_FLIGHT_STATUSES = ['pending', 'extracting', 'ocr', 'chunking']

const EXTRACTION_STAGES = [
  { key: 'downloading',     label: 'Téléchargement',      pct: 10 },
  { key: 'extracting_text', label: 'Extraction du texte', pct: 25 },
  { key: 'rendering_pages', label: 'Rendu des pages',     pct: 45 },
  { key: 'llm_analysis',   label: 'Analyse IA',           pct: 70 },
  { key: 'persisting',     label: 'Enregistrement',       pct: 90 },
] as const

// Délais (ms) avant d'afficher chaque étape — calés sur les durées typiques.
const STAGE_DELAYS_MS = [4000, 12000, 22000, 45000, 95000]

function stageInfo(key: string | null): { label: string; pct: number } {
  const found = EXTRACTION_STAGES.find((s) => s.key === key)
  return found ?? { label: 'Démarrage', pct: 5 }
}

// Maximum que le crawl peut atteindre dans l'étape courante (sans empiéter sur la suivante).
function crawlCeiling(currentPct: number): number {
  for (let i = EXTRACTION_STAGES.length - 1; i >= 0; i--) {
    if (currentPct >= EXTRACTION_STAGES[i].pct) {
      return i < EXTRACTION_STAGES.length - 1
        ? EXTRACTION_STAGES[i + 1].pct - 3
        : 97
    }
  }
  return 9
}

export function DocumentActions({
  documentId,
  documentType,
  analysisStatus,
  avgCostUsd,
  costSampleCount,
  extractionInProgress = false,
  latestRunId,
}: {
  documentId: string
  documentType: string
  analysisStatus: string
  avgCostUsd?: number | null
  costSampleCount?: number
  extractionInProgress?: boolean
  latestRunId?: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [extracting, setExtracting] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [pct, setPct] = useState(0)

  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const crawlInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearStageTimers = useCallback(() => {
    stageTimers.current.forEach((t) => clearTimeout(t))
    stageTimers.current = []
  }, [])

  const stopPolling = useCallback(() => {
    if (pollInterval.current) { clearInterval(pollInterval.current); pollInterval.current = null }
  }, [])

  const stopCrawl = useCallback(() => {
    if (crawlInterval.current) { clearInterval(crawlInterval.current); crawlInterval.current = null }
  }, [])

  // +1 % toutes les 5 s dans l'étape courante, plafonné juste avant l'étape suivante.
  // Évite que la barre reste figée pendant les longues étapes (analyse IA, enregistrement).
  const startCrawl = useCallback(() => {
    stopCrawl()
    crawlInterval.current = setInterval(() => {
      setPct((prev) => {
        const ceiling = crawlCeiling(prev)
        return prev < ceiling ? prev + 1 : prev
      })
    }, 5000)
  }, [stopCrawl])

  // Avancement automatique par timers pour une extraction lancée depuis cette page.
  // Le crawl démarre après chaque étape pour que la barre bouge pendant les longues phases.
  const startStageTimers = useCallback(() => {
    clearStageTimers()
    EXTRACTION_STAGES.forEach((s, i) => {
      const t = setTimeout(() => {
        setStage(s.key)
        setPct(s.pct)
        startCrawl()
      }, STAGE_DELAYS_MS[i])
      stageTimers.current.push(t)
    })
  }, [clearStageTimers, startCrawl])

  // Polling du statut d'un run existant.
  // La barre ne recule jamais (Math.max) ; le crawl tourne en parallèle.
  const startPolling = useCallback((runId: string) => {
    stopPolling()
    startCrawl()
    pollInterval.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/extraction/historical-pv?runId=${runId}`)
        if (!r.ok) return
        const data = await r.json()
        const { status, currentStage } = data as { status: string; currentStage: string | null; errorMessage: string | null }
        const info = stageInfo(currentStage)
        setStage(currentStage)
        setPct((prev) => Math.max(prev, info.pct))
        if (status === 'ready_for_review' || status === 'failed') {
          stopPolling()
          stopCrawl()
          setExtracting(false)
          if (status === 'ready_for_review') {
            setPct(100)
            setMsg({ ok: true, text: 'Analyse terminée.' })
            router.refresh()
          } else {
            setMsg({ ok: false, text: data.errorMessage ?? 'L\'analyse a échoué.' })
          }
        }
      } catch { /* réseau — prochain tick */ }
    }, 3000)
  }, [stopPolling, stopCrawl, startCrawl, router])

  // Si la page est chargée avec un run déjà en cours, on poll immédiatement.
  useEffect(() => {
    if (!extractionInProgress || !latestRunId) return
    setExtracting(true)
    setPct(5)
    startPolling(latestRunId)
    return () => { stopPolling(); stopCrawl(); clearStageTimers() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onAnalyzePv() {
    setMsg(null)
    setExtracting(true)
    setPct(5)
    setStage(null)
    startStageTimers()

    try {
      const r = await fetch('/api/extraction/historical-pv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      clearStageTimers()
      stopCrawl()
      const data = await r.json() as { ok?: boolean; error?: string; runId?: string }

      if (r.ok && data.ok && data.runId) {
        // Extraction lancée en arrière-plan — poll jusqu'à la fin.
        startPolling(data.runId)
      } else if (r.ok && data.ok) {
        // Chemin legacy synchrone (ne devrait plus arriver).
        setExtracting(false)
        setPct(100)
        setMsg({ ok: true, text: 'Analyse terminée.' })
        router.refresh()
      } else if (r.status === 409 && data.runId) {
        // Run déjà en cours — s'y attacher sans réinitialiser la barre.
        startPolling(data.runId)
      } else {
        setExtracting(false)
        setMsg({ ok: false, text: data.error ?? 'Échec de l\'analyse.' })
      }
    } catch {
      clearStageTimers()
      stopCrawl()
      setExtracting(false)
      setMsg({ ok: false, text: 'Erreur réseau.' })
    }
  }

  function onRelaunch() {
    setMsg(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      const r = await relaunchDocumentAnalysisAction(fd)
      if (r.ok) {
        setMsg({ ok: true, text: 'Analyse relancée — patiente quelques instants puis rafraîchis.' })
        router.refresh()
      } else {
        setMsg({ ok: false, text: r.error ?? 'Échec' })
      }
    })
  }

  function onDelete() {
    if (!window.confirm(
      'Supprimer ce document ?\n\n' +
      'Le fichier est conservé (restauration possible).\n' +
      'Les analyses IA dérivées (chunks d\'embedding, résonances site) sont nettoyées.',
    )) return
    setMsg(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      const r = await deleteDocumentAction(fd)
      if (r.ok) {
        router.push('/documents')
      } else {
        setMsg({ ok: false, text: r.error ?? 'Échec' })
      }
    })
  }

  const analysisInFlight = IN_FLIGHT_STATUSES.includes(analysisStatus)
  const isHistoricalPv = documentType === 'historical_visit_report'
  const currentInfo = stageInfo(stage)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        {isHistoricalPv ? (
          <Button
            type="button"
            variant="outline"
            onClick={onAnalyzePv}
            disabled={pending || extracting}
          >
            {extracting ? '…' : 'Analyser ce PV'}
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              onClick={onRelaunch}
              disabled={pending || analysisInFlight}
              title={analysisInFlight ? 'Analyse en cours' : undefined}
            >
              {pending ? '…' : 'Réanalyser'}
            </Button>
            <AiCostHint avgUsd={avgCostUsd} sampleCount={costSampleCount} label="analyse de document" />
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onDelete}
          disabled={pending || extracting}
          className="text-destructive hover:text-destructive"
        >
          {pending ? '…' : 'Supprimer'}
        </Button>
        {msg && (
          <p className={`text-sm ${msg.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
            {msg.text}
          </p>
        )}
      </div>

      {isHistoricalPv && extracting && (
        <div className="space-y-1.5 max-w-sm">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{currentInfo.label}…</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-foreground transition-[width] duration-1000 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
