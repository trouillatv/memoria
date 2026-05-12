import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TenderExportButtons } from './TenderExportButtons'
import type { DbTender, DbTenderAnalysis } from '@/types/db'

interface TenderMemoireTechniqueProps {
  tender: DbTender
  analysis: DbTenderAnalysis
}

export function TenderMemoireTechnique({ tender, analysis }: TenderMemoireTechniqueProps) {
  const rawMemo = analysis.technical_memo

  if (!rawMemo) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
        Aucun mémoire technique généré pour cet appel d&apos;offres.
      </div>
    )
  }

  // Slice 4.3 : strip les markers de backlink `<!-- ref: engagement:UUID -->`
  // pour qu'ils n'apparaissent ni dans le rendu, ni dans les exports.
  // Les markers restent en DB pour idempotence + traçabilité.
  const memo = rawMemo
    .replace(/<!-- ref: engagement:[0-9a-f-]+ -->/gi, '')
    .replace(/\n{3,}/g, '\n\n')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Généré par IA</p>
        <TenderExportButtons markdown={memo} tenderTitle={tender.title} />
      </div>

      <div className="rounded-xl border bg-card p-6 prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-primary">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo}</ReactMarkdown>
      </div>
    </div>
  )
}
