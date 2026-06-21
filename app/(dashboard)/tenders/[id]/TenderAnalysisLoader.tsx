'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

interface TenderAnalysisLoaderProps {
  id: string
}

// Durée typique d'une analyse. La barre progresse vers ~95 % sur cette base puis
// attend la vraie fin (réponse du POST /analyze, ou statut != analyzing).
const EXPECTED_SECONDS = 75

export function TenderAnalysisLoader({ id }: TenderAnalysisLoaderProps) {
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const triggeredRef = useRef(false)
  const doneRef = useRef(false)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    router.refresh()
  }, [router])

  // 1) DÉCLENCHE l'analyse (une seule fois). Elle tourne DANS cette requête HTTP
  //    (fiable sur Vercel, contrairement à after() qui est coupé). Le navigateur
  //    garde la fonction vivante jusqu'à la réponse.
  useEffect(() => {
    if (triggeredRef.current) return
    triggeredRef.current = true
    ;(async () => {
      try {
        const res = await fetch(`/api/tenders/${id}/analyze`, { method: 'POST' })
        const data = await res.json().catch(() => ({} as { error?: string }))
        // Affiche le code HTTP + le message exact (diagnostic) au lieu d'un texte générique.
        if (!res.ok) setError(`(${res.status}) ${data?.error ?? 'Échec de l\'analyse'}`)
        finish() // statut désormais terminal (ready/failed) → la page se met à jour
      } catch (e) {
        setError(e instanceof Error ? `Réseau : ${e.message}` : 'Erreur réseau')
        // Le poll de secours ci-dessous prend aussi le relais.
      }
    })()
  }, [id, finish])

  // Compteur de temps écoulé (alimente la barre).
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 2) Poll de secours : si le POST est coupé (réseau) ou si un autre onglet a
  //    déjà lancé l'analyse, on détecte la fin via le statut.
  useEffect(() => {
    const MAX_POLLS = 100 // ~5 min
    let polls = 0
    const interval = setInterval(async () => {
      polls += 1
      if (polls >= MAX_POLLS) {
        clearInterval(interval)
        setTimedOut(true)
        return
      }
      try {
        const res = await fetch(`/api/tenders/${id}/status`)
        if (!res.ok) return
        const data = await res.json()
        if (data.status !== 'analyzing' && data.status !== 'extracting') {
          clearInterval(interval)
          finish()
        }
      } catch {
        // erreur réseau — on continue à poller
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [id, finish])

  const pct = timedOut
    ? 100
    : Math.min(95, Math.round((1 - Math.exp(-elapsed / (EXPECTED_SECONDS / 1.6))) * 100))
  const remaining = Math.max(0, EXPECTED_SECONDS - elapsed)

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />

      <div className="w-full max-w-md space-y-1.5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${timedOut ? 'bg-rose-500' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>{timedOut ? 'Délai dépassé' : 'Analyse en cours…'}</span>
          <span className="tabular-nums">
            {timedOut ? `${elapsed}s` : remaining > 0 ? `~${remaining}s restantes` : 'bientôt prête…'}
          </span>
        </div>
      </div>

      {!timedOut && !error && (
        <p className="text-xs text-muted-foreground/70 text-center max-w-md">
          Lecture du document, contraintes et risques, mémoire technique, score d&apos;opportunité.
          L&apos;estimation est indicative — la page se met à jour dès que l&apos;analyse est prête.
        </p>
      )}

      {error && (
        <p className="text-sm text-rose-700 text-center max-w-md">{error} — rechargez la page pour relancer.</p>
      )}

      {timedOut && !error && (
        <p className="text-sm text-rose-700 text-center max-w-md">
          L&apos;analyse n&apos;a pas répondu dans le temps imparti. Rechargez la page : vous pourrez la relancer.
        </p>
      )}
    </div>
  )
}
