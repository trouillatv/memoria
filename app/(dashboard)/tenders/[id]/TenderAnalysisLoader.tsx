'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

interface TenderAnalysisLoaderProps {
  id: string
}

export function TenderAnalysisLoader({ id }: TenderAnalysisLoaderProps) {
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(async () => {
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
    </div>
  )
}
