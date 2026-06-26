'use client'

import { useState, useTransition } from 'react'
import { FileText, Copy, Download } from 'lucide-react'
import { toast } from 'sonner'
import { generateVisitCrAction } from '../actions'

/**
 * Le CR comme PROJECTION du Débrief : un bouton qui rend le compte-rendu à partir
 * des éléments validés (zéro IA, zéro fait nouveau). Le CR n'est pas le cœur —
 * c'est une sortie du Débrief, régénérable à volonté.
 */
export function GenerateCrButton({ reportId }: { reportId: string }) {
  const [pending, start] = useTransition()
  const [cr, setCr] = useState<string | null>(null)

  function generate() {
    start(async () => {
      const res = await generateVisitCrAction(reportId)
      if (!res.ok) { toast.error(res.error); return }
      setCr(res.cr)
    })
  }

  function copy() {
    if (!cr) return
    navigator.clipboard.writeText(cr).then(
      () => toast.success('CR copié', { duration: 1500 }),
      () => toast.error('Copie impossible'),
    )
  }

  function download() {
    if (!cr) return
    const blob = new Blob([cr], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `CR-visite.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Compte-rendu</h2>
          <p className="text-xs text-muted-foreground">Projection des éléments validés. Le CR n’est qu’une sortie du Débrief.</p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-xl border bg-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          {pending ? 'Génération…' : cr ? 'Régénérer' : 'Générer le CR'}
        </button>
      </div>

      {cr && (
        <div className="space-y-2">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm">{cr}</pre>
          <div className="flex gap-2">
            <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/40">
              <Copy className="h-3.5 w-3.5" /> Copier
            </button>
            <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted/40">
              <Download className="h-3.5 w-3.5" /> Télécharger
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
