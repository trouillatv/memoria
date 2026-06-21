'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

interface TenderAnalysisLoaderProps {
  id: string
}

// Durée typique d'une analyse (lecture + mémoire technique + score). La barre
// progresse vers ~95 % sur cette base puis attend la vraie fin (statut != analyzing).
const EXPECTED_SECONDS = 75

export function TenderAnalysisLoader({ id }: TenderAnalysisLoaderProps) {
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const pollCountRef = useRef(0)

  // Compteur de temps écoulé (1 s) → alimente la barre + l'estimation restante.
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    // Poll toutes les 3 s pendant 5 min (100 tentatives) — plus long que le
    // seuil serveur d'auto-fail (4 min, cf. /api/tenders/[id]/status) pour que
    // l'AO bloqué bascule en `failed` AVANT qu'on arrête de poller.
    const MAX_POLLS = 100
    const interval = setInterval(async () => {
      pollCountRef.current += 1
      if (pollCountRef.current >= MAX_POLLS) {
        clearInterval(interval)
        setTimedOut(true)
        return
      }
      try {
        const res = await fetch(`/api/tenders/${id}/status`)
        if (!res.ok) return
        const data = await res.json()
        const inProgress = data.status === 'analyzing' || data.status === 'extracting'
        if (!inProgress) {
          clearInterval(interval)
          router.refresh()
        }
      } catch {
        // Network error — keep polling
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [id, router])

  // Progression estimée : ease-out asymptotique vers 95 % (ne ment jamais sur la
  // fin — elle n'atteint 100 % qu'au vrai changement de statut, via router.refresh).
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

      {!timedOut && (
        <p className="text-xs text-muted-foreground/70 text-center max-w-md">
          Lecture du document, contraintes et risques, mémoire technique, score d&apos;opportunité.
          L&apos;estimation est indicative — la page se met à jour dès que l&apos;analyse est prête.
        </p>
      )}

      {timedOut && (
        <p className="text-sm text-rose-700 text-center max-w-md">
          L&apos;analyse n&apos;a pas répondu dans le temps imparti. Rechargez la page : l&apos;analyse
          devrait apparaître en échec, vous pourrez alors la relancer. Si le problème persiste,
          contactez l&apos;admin.
        </p>
      )}
    </div>
  )
}
