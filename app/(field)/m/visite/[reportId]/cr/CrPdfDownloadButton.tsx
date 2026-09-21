'use client'

// Le bouton « Télécharger » était un <a download> brut : un échec serveur
// (ex. PDF trop volumineux pour la réponse d'une fonction Vercel, cf. La Foa
// 13,19 Mo) se traduisait par une navigation qui ne fait rien de visible —
// Guillaume ne sait pas si MemorIA a raté quelque chose ou s'il doit patienter.
// On fetch le PDF nous-mêmes pour distinguer explicitement génération en
// cours / échec / succès, et proposer un vrai geste de reprise (Vincent,
// 2026-09-21). Les modifications du CR restent enregistrées indépendamment de
// ce téléchargement — l'erreur ne doit jamais laisser croire le contraire.

import { useState } from 'react'
import { Download, Loader2, AlertTriangle } from 'lucide-react'

type DownloadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header ? /filename="?([^";]+)"?/.exec(header) : null
  return match?.[1] ?? fallback
}

export function CrPdfDownloadButton({ href }: { href: string }) {
  const [state, setState] = useState<DownloadState>({ kind: 'idle' })

  const handleDownload = async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(href, { cache: 'no-store' })
      if (!res.ok) {
        const msg =
          res.status === 413
            ? 'Le compte-rendu est trop volumineux pour être généré.'
            : `La génération du PDF a échoué (code ${res.status}).`
        throw new Error(msg)
      }
      const blob = await res.blob()
      const filename = filenameFromDisposition(res.headers.get('content-disposition'), 'compte-rendu.pdf')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setState({ kind: 'idle' })
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'La génération du PDF a échoué.',
      })
    }
  }

  return (
    <div className="contents">
      <button
        type="button"
        onClick={handleDownload}
        disabled={state.kind === 'loading'}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background active:brightness-95 disabled:opacity-60"
      >
        {state.kind === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {state.kind === 'loading' ? 'Génération…' : 'Télécharger'}
      </button>
      {state.kind === 'error' && (
        <div className="col-span-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="flex-1">
            <p>{state.message}</p>
            <p className="mt-1 text-amber-700 dark:text-amber-400">Vos modifications restent enregistrées.</p>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium dark:border-amber-800 dark:bg-transparent"
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  )
}
