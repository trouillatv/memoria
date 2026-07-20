'use client'

import { documentHref } from '@/lib/knowledge/document-href'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileText, Link2, X, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { linkObligationDocumentAction, unlinkObligationDocumentAction } from './actions'
import type { LinkedDocument } from '@/lib/db/documents'

interface Props {
  siteId: string
  obligationId: string
  linked: LinkedDocument[]
  /** Documents du site, source du sélecteur. */
  siteDocs: Array<{ id: string; filename: string }>
}

/** Bloc « Document lié » d'une obligation (mig 151) — Option A : on RATTACHE le
 *  CCTP/PAQ source + une référence libre (« chapitre 4.2 »). Aucun parsing, aucune
 *  IA : MemorIA pointe le document, il ne prétend pas le comprendre. */
export function ObligationDocLink({ siteId, obligationId, linked, siteDocs }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [adding, setAdding] = useState(false)
  const [docId, setDocId] = useState('')
  const [ref, setRef] = useState('')

  const linkedIds = new Set(linked.map((l) => l.documentId))
  const available = siteDocs.filter((d) => !linkedIds.has(d.id))

  function link() {
    if (!docId) return
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('obligationId', obligationId)
    fd.set('documentId', docId); fd.set('referenceLabel', ref)
    start(async () => {
      const r = await linkObligationDocumentAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Document lié'); setAdding(false); setDocId(''); setRef(''); router.refresh()
    })
  }

  function unlink(linkId: string) {
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('linkId', linkId)
    start(async () => {
      const r = await unlinkObligationDocumentAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Lien retiré'); router.refresh()
    })
  }

  return (
    <div className="space-y-1.5 border-t pt-1.5">
      {linked.length > 0 && (
        <ul className="space-y-1">
          {linked.map((l) => (
            <li key={l.linkId} className="flex items-center gap-1.5 text-[11px]">
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              {/* Le chantier est connu : le lien ouvre la fiche document du graphe.
                  La visionneuse /documents/<id> reste la sortie depuis la fiche. */}
              <Link href={documentHref({ id: l.documentId, document_type: l.documentType }, siteId)} scroll={false} className="font-medium hover:underline">{l.filename}</Link>
              {l.referenceLabel && <span className="text-muted-foreground">— {l.referenceLabel}</span>}
              <button type="button" disabled={pending} onClick={() => unlink(l.linkId)}
                className="ml-auto text-muted-foreground hover:text-rose-700" aria-label="Retirer le lien">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={docId} onChange={(e) => setDocId(e.target.value)} disabled={pending}
            className="rounded border bg-background px-1.5 py-0.5 text-[11px] max-w-[180px]">
            <option value="">Choisir un document…</option>
            {available.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
          </select>
          <input value={ref} onChange={(e) => setRef(e.target.value)} disabled={pending} maxLength={160}
            placeholder="Réf. (ex : CCTP ch. 4.2 / p.18)"
            className="rounded border bg-background px-1.5 py-0.5 text-[11px] max-w-[180px]" />
          <button type="button" disabled={pending || !docId} onClick={link}
            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted/40 disabled:opacity-50">
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Lier
          </button>
          <button type="button" disabled={pending} onClick={() => setAdding(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground">Annuler</button>
        </div>
      ) : (
        available.length > 0 && (
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <Plus className="h-3 w-3" /> Lier un document (CCTP, PAQ…)
          </button>
        )
      )}
    </div>
  )
}
