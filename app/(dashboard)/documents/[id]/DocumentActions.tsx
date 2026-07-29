'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { relaunchDocumentAnalysisAction, deleteDocumentAction } from '../actions'
import { AiCostHint } from '../AiCostHint'

const IN_FLIGHT_STATUSES = ['pending', 'extracting', 'ocr', 'chunking']

// Étapes de l'extraction PV historique — label affiché dans la barre de progression.
const EXTRACTION_STAGES: { key: string; label: string; pct: number }[] = [
  { key: 'downloading',     label: 'Téléchargement',      pct: 10 },
  { key: 'extracting_text', label: 'Extraction du texte', pct: 25 },
  { key: 'rendering_pages', label: 'Rendu des pages',     pct: 45 },
  { key: 'llm_analysis',   label: 'Analyse IA',           pct: 70 },
  { key: 'persisting',     label: 'Enregistrement',       pct: 90 },
]

function stageProgress(stage: string | null): { label: string; pct: number } {
  const found = EXTRACTION_STAGES.find((s) => s.key === stage)
  return found ?? { label: 'Démarrage', pct: 5 }
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

  // État de la barre de progression (extraction PV historique uniquement)
  const [extracting, setExtracting] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentRunId = useRef<string | null>(latestRunId ?? null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // Polling du statut d'un run déjà en cours au chargement de la page.
  useEffect(() => {
    if (!extractionInProgress || !latestRunId) return
    setExtracting(true)
    currentRunId.current = latestRunId
    startPolling(latestRunId)
    return stopPolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startPolling(runId: string) {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/extraction/historical-pv?runId=${runId}`)
        if (!r.ok) return
        const data = await r.json()
        const { status, currentStage } = data
        setStage(currentStage ?? null)
        const p = stageProgress(currentStage)
        setPct(p.pct)
        if (status === 'ready_for_review' || status === 'failed') {
          stopPolling()
          setExtracting(false)
          setPct(100)
          if (status === 'ready_for_review') {
            setMsg({ ok: true, text: 'Analyse terminée.' })
            router.refresh()
          } else {
            setMsg({ ok: false, text: data.errorMessage ?? 'L\'analyse a échoué.' })
          }
        }
      } catch { /* réseau — on réessaie au prochain tick */ }
    }, 3000)
  }

  async function onAnalyzePv() {
    setMsg(null)
    setExtracting(true)
    setPct(5)
    setStage(null)

    try {
      const r = await fetch('/api/extraction/historical-pv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      const data = await r.json()

      setExtracting(false)
      setPct(100)
      stopPolling()

      if (r.ok && data.ok) {
        setMsg({ ok: true, text: 'Analyse terminée.' })
        router.refresh()
      } else if (r.status === 409) {
        // Run déjà en cours — on attache le polling à ce run
        setExtracting(true)
        setPct(5)
        if (data.runId) {
          currentRunId.current = data.runId
          startPolling(data.runId)
        }
      } else {
        setMsg({ ok: false, text: data.error ?? 'Échec de l\'analyse.' })
      }
    } catch (e) {
      setExtracting(false)
      stopPolling()
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
  const currentStageInfo = stageProgress(stage)

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

      {/* Barre de progression — visible pendant l'extraction PV historique */}
      {isHistoricalPv && extracting && (
        <div className="space-y-1.5 max-w-sm">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{currentStageInfo.label}…</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-foreground transition-all duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
