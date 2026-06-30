'use client'

import { useState, useTransition } from 'react'
import { FileDown, Copy, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { buildPrevisiteSynthesisAction } from './actions'

/**
 * Export « Synthèse de prévisite pour réponse AO » — léger : on génère le texte
 * côté serveur (déterministe) puis, côté client, on le COPIE dans le presse-papier
 * ou on le TÉLÉCHARGE en .md. Pas de pipeline PDF lourd : « je pose mon tél, j'ai
 * ma synthèse à coller dans ma réponse ».
 */
export function ExportSynthesisButton({ dossierId }: { dossierId: string }) {
  const [pending, start] = useTransition()
  const [copied, setCopied] = useState(false)

  function run(mode: 'copy' | 'download') {
    start(async () => {
      const res = await buildPrevisiteSynthesisAction(dossierId)
      if (!res.ok) { toast.error(res.error); return }
      if (mode === 'copy') {
        try {
          await navigator.clipboard.writeText(res.text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
          toast.success('Synthèse copiée — collez-la dans votre réponse AO.')
        } catch {
          toast.error('Copie impossible — utilisez « Télécharger ».')
        }
      } else {
        const blob = new Blob([res.text], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        toast.success('Synthèse téléchargée.')
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2.5 dark:border-sky-900/40 dark:bg-sky-950/20">
      <span className="text-sm font-medium text-sky-900 dark:text-sky-200">Synthèse de prévisite pour réponse AO</span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button" onClick={() => run('copy')} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copié' : 'Copier'}
        </button>
        <button
          type="button" onClick={() => run('download')} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50 dark:text-sky-300"
        >
          <FileDown className="h-4 w-4" /> .md
        </button>
      </div>
    </div>
  )
}
