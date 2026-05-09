'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

interface TenderAnalysisLoaderProps {
  id: string
}

export function TenderAnalysisLoader({ id }: TenderAnalysisLoaderProps) {
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)
  const pollCountRef = useRef(0)

  useEffect(() => {
    const interval = setInterval(async () => {
      pollCountRef.current += 1
      if (pollCountRef.current >= 60) {
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

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Analyse en cours… Cela peut prendre quelques secondes.</p>
      {timedOut && (
        <p className="text-sm text-rose-700 text-center max-w-md">
          Délai dépassé (3 min). L&apos;analyse n&apos;a pas répondu. Contactez l&apos;admin ou rechargez la page pour relancer.
        </p>
      )}
    </div>
  )
}
