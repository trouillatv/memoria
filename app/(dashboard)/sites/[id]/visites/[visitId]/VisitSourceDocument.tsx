import Link from 'next/link'
import { FileText, Download, ExternalLink } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { VisitSourceDocument } from '@/lib/db/visit-source-document'

function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

export async function VisitSourceDocumentCard({ doc, siteId }: { doc: VisitSourceDocument; siteId: string }) {
  const admin = createAdminClient()
  const { data } = await admin.storage.from('documents').createSignedUrl(doc.storagePath, 3600)
  const downloadUrl = data?.signedUrl ?? null

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Document source</h2>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{doc.filename}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {doc.effectiveDate && (
              <span>PV du {new Date(doc.effectiveDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
            )}
            {doc.pageCount && (
              <span>{doc.pageCount} page{doc.pageCount > 1 ? 's' : ''}</span>
            )}
            {doc.sizeBytes && (
              <span>{formatFileSize(doc.sizeBytes)}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {downloadUrl && (
            <>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ouvrir
              </a>
              <a
                href={downloadUrl}
                download={doc.filename}
                className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger
              </a>
            </>
          )}
          <Link
            href={`/sites/${siteId}/documents?doc=${doc.id}`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-muted"
          >
            Voir dans les documents
          </Link>
        </div>
      </div>
    </div>
  )
}
