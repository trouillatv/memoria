'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { relaunchDocumentAnalysisAction, deleteDocumentAction } from '../actions'
import { AiCostHint } from '../AiCostHint'

const IN_FLIGHT_STATUSES = ['pending', 'extracting', 'ocr', 'chunking']

// Étapes de l'extraction PV historique.
// pct = valeur cible de la barre quand cette étape est active.
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

  // Timers pour l'avancement automatique de la barre
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  // Interval pour le polling de statut (run déjà en cours)
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearStageTimers = useCallback(() => {
    stageTimers.current.forEach((t) => clearTimeout(t))
    stageTimers.current = []
  }, [])

  const stopPolling = useCallback(() => {
    if (pollInterval.current) { clearInterval(pollInterval.current); pollInterval.current = null }
  }, [])

  // Démarre l'avancement automatique de la barre pendant que la route tourne.
  // Les délais sont calés sur les durées réelles observées pour donner une
  // impression fidèle même sans polling DB.
  const startStageTimers = useCallback(() => {
    clearStageTimers()
    EXTRACTION_STAGES.forEach((s, i) => {
      const t = setTimeout(() => {
        setStage(s.key)
        setPct(s.pct)
      }, STAGE_DELAYS_MS[i])
      stageTimers.current.push(t)
    })
  }, [clearStageTimers])

  // Polling du statut d'un run existant (page chargée avec extractionInProgress).
  const startPolling = useCallback((runId: string) => {
    stopPolling()
    pollInterval.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/extraction/historical-pv?runId=${runId}`)
        if (!r.ok) return
        const data = await r.json()
        const { status, currentStage } = data as { status: string; currentStage: string | null; errorMessage: string | null }
        const info = stageInfo(currentStage)
        setStage(currentStage)
        setPct(info.pct)
        if (status === 'ready_for_review' || status === 'failed') {
          stopPolling()
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
  }, [stopPolling, router])

  // Si la page est chargée avec un run déjà en cours, on poll immédiatement.
  useEffect(() => {
    if (!extractionInProgress || !latestRunId) return
    setExtracting(true)
    setPct(5)
    startPolling(latestRunId)
    return () => { stopPolling(); clearStageTimers() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onAnalyzePv() {
    setMsg(null)
    setExtracting(true)
    setPct(5)
    setStage(null)

    // Avancement automatique : la barre avance pendant que le fetch attend la réponse.
    // Quand le fetch retourne (200 ou erreur), on annule les timers.
    startStageTimers()

    try {
      const r = await fetch('/api/extraction/historical-pv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      clearStageTimers()
      const data = await r.json() as { ok?: boolean; error?: string; runId?: string }

      if (r.ok && data.ok) {
        setExtracting(false)
        setPct(100)
        setMsg({ ok: true, text: 'Analyse terminée.' })
        router.refresh()
      } else if (r.status === 409 && data.runId) {
        // Un run est déjà en cours — on s'y attache en polling.
        setPct(5)
        setStage(null)
        startPolling(data.runId)
      } else {
        setExtracting(false)
        setMsg({ ok: false, text: data.error ?? 'Échec de l\'analyse.' })
      }
    } catch {
      clearStageTimers()
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
              className="h-full rounded-full bg-foreground transition-all duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
