'use client'

// P5-F2a — geste humain explicite : archiver une information de la Mémoire.
// Jamais automatique (aucun TTL/cron) — uniquement ce bouton.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { archiveKnowledgeEntryAction } from '@/app/(dashboard)/sites/[id]/memoire-actions'

export function ArchiveKnowledgeEntryButton({ siteId, entryId }: { siteId: string; entryId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function submit() {
    if (!window.confirm('Marquer cette information comme obsolète ? Elle sortira de la mémoire actuelle du chantier.')) return
    start(async () => {
      const formData = new FormData()
      formData.set('siteId', siteId)
      formData.set('entryId', entryId)
      const r = await archiveKnowledgeEntryAction(formData)
      if ('ok' in r) {
        router.refresh()
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={submit}
      disabled={pending}
      className="ml-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
      title="Marquer comme obsolète"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
      Marquer comme obsolète
    </button>
  )
}
