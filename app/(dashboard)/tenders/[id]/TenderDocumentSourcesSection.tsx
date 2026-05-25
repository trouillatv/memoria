// AO-1 L3 — Section « Sources documentaires de l'analyse ».
//
// Vincent 2026-05-21 : « rendre les sources documentaires persistées dans
// tender_analyses.document_sources visibles et cliquables ; ouvrir
// /documents/[id] ; si possible panneau latéral léger, sinon lien simple
// d'abord. »
//
// MVP : lien simple cliquable. Panneau latéral peut suivre en AO-2.

import Link from 'next/link'
import { FileText, Scale, BookText, ArrowUpRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TenderDocumentSource } from '@/lib/db/tender-document-sources'

/**
 * Icône par type de document. On reste sobre — pas de couleurs criardes.
 * `litige` reçoit une icône distincte (balance) pour signalement visuel.
 */
function iconFor(documentType: string | null) {
  if (documentType === 'litige') return Scale
  if (documentType === 'reference' || documentType === 'AO_passé') return BookText
  return FileText
}

interface Props {
  sources: TenderDocumentSource[]
  tenderId: string
}

export function TenderDocumentSourcesSection({ sources, tenderId }: Props) {
  if (sources.length === 0) return null

  return (
    <Card data-slot="tender-document-sources">
      <CardHeader>
        <CardTitle className="text-base inline-flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Sources documentaires de l&apos;analyse ({sources.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {sources.map((s) => {
            const Icon = iconFor(s.documentType)
            return (
              <li key={s.id} className="px-6 py-3">
                <Link
                  href={`/documents/${s.id}?from=/tenders/${tenderId}`}
                  className="flex items-start gap-3 hover:bg-muted/30 -mx-6 px-6 py-1 -my-1 transition-colors group"
                >
                  <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{s.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {s.documentType && (
                        <span className="inline-flex items-center rounded-full border bg-muted/40 px-1.5 py-0.5 text-[10px]">
                          {s.documentType}
                        </span>
                      )}
                      {s.documentType === 'litige' && (
                        <span className="text-[10px] text-amber-700 dark:text-amber-300 italic">
                          Document litige — consulter avec prudence
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors mt-1" />
                </Link>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
