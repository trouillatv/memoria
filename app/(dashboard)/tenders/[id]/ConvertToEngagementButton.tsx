'use client'

// A2 — Promotion Atelier → Objet (Vincent). Une réflexion d'un échange IA devient
// un engagement suivi. L'humain CHOISIT (libellé + nature), jamais en automatique.
// L'engagement rejoint ensuite le pont → obligation → sujet comme les autres.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { promoteMessageToEngagementAction } from './atelier-actions'
import { KIND_META } from '@/lib/engagements/kind'
import type { EngagementKind } from '@/types/db'

const KINDS: EngagementKind[] = ['obligation', 'livrable', 'controle', 'objectif', 'penalite']

export function ConvertToEngagementButton({ tenderId, content }: { tenderId: string; content: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [label, setLabel] = useState(() => content.replace(/\s+/g, ' ').trim().slice(0, 100))
  const [kind, setKind] = useState<EngagementKind>('obligation')

  function create() {
    const l = label.trim()
    if (l.length < 3) { toast.error('Libellé trop court'); return }
    const fd = new FormData()
    fd.set('tender_id', tenderId)
    fd.set('short_label', l)
    fd.set('excerpt', content)
    fd.set('kind', kind)
    start(async () => {
      const r = await promoteMessageToEngagementAction(fd)
      if (r && 'error' in r) { toast.error(r.error); return }
      toast.success("Engagement créé depuis l'échange")
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
        <Sparkles className="h-3 w-3" /> Transformer en engagement
      </button>
    )
  }

  return (
    <div className="mt-2 rounded-lg border bg-muted/20 p-2.5 space-y-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} disabled={pending}
        className="w-full rounded border p-1.5 text-xs" placeholder="Libellé court (3-100 caractères)" />
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-muted-foreground mr-0.5">Nature</span>
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} disabled={pending}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${kind === k ? KIND_META[k].badge : 'hover:bg-muted/50'}`}>
            {KIND_META[k].label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={create} disabled={pending || label.trim().length < 3}
          className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 disabled:opacity-50">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Créer l&apos;engagement
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending}
          className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]"><X className="h-3 w-3" /> Annuler</button>
      </div>
    </div>
  )
}
