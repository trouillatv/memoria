import { Search, ChevronDown, FileText, BookOpen, Sparkles, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import type { Source } from '@/types/db'

export function SourceList({ sources }: { sources: Source[] }) {
  if (!sources || sources.length === 0) return null
  return (
    <details className="group mt-1.5">
      <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors flex items-center gap-1 select-none list-none">
        <Search className="h-2.5 w-2.5" />
        <span>{sources.length} source{sources.length > 1 ? 's' : ''}</span>
        <ChevronDown className="h-2.5 w-2.5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-1.5 space-y-1.5 border-l-2 border-muted-foreground/20 pl-2.5">
        {sources.map((s, i) => (
          <li key={i} className="text-[11px] space-y-0.5">
            <div className="text-foreground/85 italic leading-snug">« {s.quote} »</div>
            <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {s.type === 'pdf' && (
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-2.5 w-2.5" />
                  PDF{typeof s.page === 'number' ? ` page ${s.page}` : ''}
                </span>
              )}
              {s.type === 'library' && (
                <span className="inline-flex items-center gap-1">
                  <BookOpen className="h-2.5 w-2.5" />
                  {s.library_item_id ? (
                    <Link href={`/library?focus=${s.library_item_id}`} className="hover:underline">
                      {s.library_item_title}
                    </Link>
                  ) : (
                    <span>{s.library_item_title}</span>
                  )}
                  {s.library_item_category ? ` · ${s.library_item_category}` : ''}
                </span>
              )}
              {s.type === 'analysis' && (
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  Analyse
                </span>
              )}
              {s.verified === false && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertCircle className="h-2.5 w-2.5" />
                  non vérifiée
                </span>
              )}
              {s.reasoning && <span className="text-muted-foreground">· {s.reasoning}</span>}
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}
