import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TenderExportButtons } from './TenderExportButtons'
import type { DbTender, DbTenderAnalysis } from '@/types/db'

interface TenderMemoireTechniqueProps {
  tender: DbTender
  analysis: DbTenderAnalysis
}

export function TenderMemoireTechnique({ tender, analysis }: TenderMemoireTechniqueProps) {
  const memo = analysis.technical_memo

  if (!memo) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground text-sm">
        Aucun mémoire technique généré pour cet appel d&apos;offres.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Mémoire technique généré par IA</h3>
        <TenderExportButtons markdown={memo} tenderTitle={tender.title} />
      </div>

      <div className="rounded-xl border bg-card p-6 prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-primary">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{memo}</ReactMarkdown>
      </div>
    </div>
  )
}
