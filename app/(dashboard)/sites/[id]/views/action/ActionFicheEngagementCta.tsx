'use client'

// ── P0-4B — rapprocher une Action à un Engagement de référence ──────────────
// « Engagement = ce qui doit être vrai. Action = quelque chose qu'il faut
// traiter. » Ce composant ne fait QUE poser/retirer ce lien déclaratif —
// jamais de conformité, d'écart, ni de mutation de l'Engagement lui-même.
// Même patron que ActionAssignmentPanel : FormData + Server Action + refresh.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Link2, X } from 'lucide-react'
import { toast } from 'sonner'
import { createEngagementLinkAction, removeEngagementLinkAction } from '@/app/(dashboard)/actions/actions'
import type { DbEngagement } from '@/types/db'
import type { SiteActionEngagementLinkView } from '@/lib/db/site-action-engagement-links'

const STATUS_LABEL: Record<string, string> = {
  extracted: 'Extrait',
  curated: 'Curé',
  active: 'Actif',
  completed: 'Terminé',
  archived: 'Archivé',
}

export function ActionFicheEngagementCta({
  actionId,
  siteId,
  links,
  candidates,
}: {
  actionId: string
  siteId: string
  links: SiteActionEngagementLinkView[]
  candidates: DbEngagement[]
}) {
  const router = useRouter()
  const [linking, setLinking] = useState(false)
  const [selected, setSelected] = useState('')
  const [pending, startTransition] = useTransition()
  const [removingId, setRemovingId] = useState<string | null>(null)

  const linkedIds = new Set(links.map((l) => l.engagement.id))
  const available = candidates.filter((c) => !linkedIds.has(c.id))

  function submitLink() {
    if (!selected) return
    const fd = new FormData()
    fd.set('actionId', actionId)
    fd.set('engagementId', selected)
    fd.set('siteId', siteId)
    startTransition(async () => {
      const r = await createEngagementLinkAction(fd)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Engagement rapproché')
      setLinking(false)
      setSelected('')
      router.refresh()
    })
  }

  function submitRemove(linkId: string) {
    setRemovingId(linkId)
    const fd = new FormData()
    fd.set('linkId', linkId)
    fd.set('actionId', actionId)
    fd.set('siteId', siteId)
    startTransition(async () => {
      const r = await removeEngagementLinkAction(fd)
      setRemovingId(null)
      if (!r.ok) { toast.error(r.error); return }
      toast.success('Rapprochement retiré')
      router.refresh()
    })
  }

  return (
    <div className="space-y-1.5">
      {links.length === 0 && !linking && (
        <p className="text-[13px] text-muted-foreground">Aucun engagement rapproché</p>
      )}

      {links.map(({ link, engagement }) => (
        <div key={link.id} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium">{engagement.short_label}</p>
            <p className="text-[11px] text-muted-foreground">{STATUS_LABEL[engagement.status] ?? engagement.status}</p>
          </div>
          <button
            type="button"
            onClick={() => submitRemove(link.id)}
            disabled={pending && removingId === link.id}
            className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground hover:text-red-600 disabled:opacity-50"
          >
            {pending && removingId === link.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Retirer le rapprochement
          </button>
        </div>
      ))}

      {linking ? (
        <div className="flex items-center gap-1.5">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={pending}
            className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— Choisir un engagement —</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{c.short_label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={submitLink}
            disabled={pending || !selected}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}OK
          </button>
          <button
            type="button"
            onClick={() => { setLinking(false); setSelected('') }}
            disabled={pending}
            className="shrink-0 rounded-md border px-2 py-1 text-[11px] hover:bg-muted/60 disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      ) : (
        available.length > 0 && (
          <button
            type="button"
            onClick={() => setLinking(true)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Link2 className="h-3 w-3" />Rapprocher à un engagement
          </button>
        )
      )}
    </div>
  )
}
